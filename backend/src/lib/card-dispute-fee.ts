import { createLogger } from "../shared/logger"
const log = createLogger("lib/card-dispute-fee")
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type HawalaLedgerModuleService from "../modules/hawala-ledger/service"
import { isVendorDisputeFeeLeg } from "../modules/hawala-ledger/vendor-receivable"
import { ordersForPaymentCollection, toCents, type CardSettlementOrder } from "./card-order-settlement"

type Container = { resolve: (key: string) => any }

/**
 * Stripe's dispute fee, owed by the vendor whose order was disputed (operator
 * answer 2026-10-07: "the vendor owes it", recovered like a refund they owe;
 * `hawala-ledger/vendor-receivable.ts`).
 *
 * Stripe takes the fee from FBM's balance when the dispute opens and never
 * returns it, win or lose, so it is owed as soon as Stripe reports it — it
 * does not wait for the outcome. The fee is on a CHARGE; the ledger owes by
 * ORDER, and a Mercur cart pays several sellers' orders with one charge. So
 * for one order (under its per-order lock, `lib/card-order-reconcile.ts`):
 *
 *   1. Every charge on the order's payment collection with a fee recorded
 *      (`hawala_card_charge_state.dispute_fee_cents`, re-read from Stripe).
 *   2. The order's share: all of it on a single-order collection. On a
 *      Mercur cart only when one chargeback covered the WHOLE charge
 *      (`disputed_cents >= amount_cents`): every order on it was disputed,
 *      so each owes in proportion to its authorised amount on its split row
 *      (largest remainder, ties to the lower order id, so the shares always
 *      sum to the fee to the cent). A partial dispute on a cart says nothing
 *      about WHICH order was disputed, and the ruling is that the vendor
 *      whose order was disputed owes it — so nothing is put on any seller,
 *      and it is logged for a person (BMC bears it unless someone assigns
 *      it; SD-44). A shared collection with no split rows cannot be
 *      attributed either: logged, nothing posted.
 *   3. Within the order, owed by its seller earnings account(s): split the
 *      same way across a consignment's consignor / vendor legs.
 *   4. Posted as the difference between that share and what is already
 *      recorded (COMPLETED, or PENDING — in flight, never posted twice), so
 *      repeats post nothing; a share that went DOWN is logged for a person,
 *      never reversed here. A FAILED attempt counts for nothing and is
 *      retried under the next sequence number (`recordDisputeFee`).
 *
 * A charge an admin has assigned by hand (`lib/card-dispute-fee-assignment.ts`,
 * recorded on the charge state's `metadata.fee_assignment`) is never posted
 * here again: it is the admin's from then on, including a later rise in the
 * fee, which returns it to the admin queue.
 *
 * Never throws; returns the cents it posted. One charge failing does not
 * stop the others.
 */

const SELLER_SIDE_KEY = /^order-payment-(.+)-(seller|consignor|vendor)$/
/** A fee leg still PENDING after this long never finished: logged for a person, never re-posted. */
const STUCK_PENDING_MS = 10 * 60 * 1000

/** Split `total` cents over integer weights: floor, then the largest remainders (ties by key). */
export function allocateCents(total: number, weights: Array<{ key: string; weight: number }>): Map<string, number> {
  const out = new Map<string, number>()
  const positive = weights.filter((w) => w.weight > 0)
  const sum = positive.reduce((s, w) => s + w.weight, 0)
  if (total <= 0 || sum <= 0) return out
  const rows = positive.map((w) => {
    const exact = (total * w.weight) / sum
    return { key: w.key, base: Math.floor(exact), rem: exact - Math.floor(exact) }
  })
  let left = total - rows.reduce((s, r) => s + r.base, 0)
  for (const r of [...rows].sort((a, b) => b.rem - a.rem || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))) {
    if (left <= 0) break
    r.base += 1
    left -= 1
  }
  for (const r of rows) if (r.base > 0) out.set(r.key, r.base)
  return out
}

export type CollectionWeights = { weights: Array<{ key: string; weight: number }>; shared: boolean }

/**
 * Each order's weight on a collection, or null when the money cannot be
 * attributed: split rows for every order on it (shared when more than one),
 * or one order and no split rows.
 */
export async function collectionWeights(container: Container, collectionId: string): Promise<CollectionWeights | null> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data: splits } = await query.graph({
    entity: "split_order_payment",
    fields: ["id", "authorized_amount", "order.id"],
    filters: { payment_collection_id: collectionId },
  })
  const rows = (splits as Array<{ authorized_amount?: unknown; order?: { id?: string } | null }>)
    .filter((s) => typeof s.order?.id === "string")
    .map((s) => ({ key: s.order!.id as string, weight: toCents(Number(s.authorized_amount) || 0) }))
  const sharers = await ordersForPaymentCollection(container, collectionId)
  if (rows.length > 0) {
    // Every order on the collection must have a split row, or the shares
    // would be computed over only part of the cart.
    const withRows = new Set(rows.map((r) => r.key))
    if (sharers.some((id) => !withRows.has(id))) return null
    return { weights: rows, shared: rows.length > 1 }
  }
  return sharers.length === 1 ? { weights: [{ key: sharers[0], weight: 1 }], shared: false } : null
}

type ChargeLike = {
  stripe_charge_id: string
  amount_cents?: unknown
  disputed_cents?: unknown
  dispute_fee_cents?: unknown
  currency_code?: unknown
  metadata?: unknown
}

/** The admin's assignment of a charge's fee, if one was made (`lib/card-dispute-fee-assignment.ts`). */
export type FeeAssignmentRecord = {
  assigned_by: string
  assigned_at: string
  /** Cents BMC absorbed instead of putting on a seller, across every assignment. */
  absorbed_cents: number
  history: Array<{ by: string; at: string; allocations: Array<{ order_id: string; cents: number }>; absorbed_cents: number }>
}

export function feeAssignmentOf(charge: { metadata?: unknown }): FeeAssignmentRecord | null {
  const fa = (charge.metadata as { fee_assignment?: unknown } | null | undefined)?.fee_assignment
  return fa && typeof fa === "object" && typeof (fa as FeeAssignmentRecord).assigned_by === "string"
    ? (fa as FeeAssignmentRecord)
    : null
}

/**
 * Whether the automatic rule decides who owes a charge's fee: a single-order
 * collection, or a cart one chargeback covered whole — and no admin has
 * taken it over. Otherwise it is the admin queue's.
 */
export function feeIsAutomatic(charge: ChargeLike, attribution: CollectionWeights | null): boolean {
  if (feeAssignmentOf(charge)) return false
  if (!attribution) return false
  if (!attribution.shared) return true
  return Number(charge.disputed_cents) >= Number(charge.amount_cents)
}

type SellerLeg = { accountId: string; tag: string; cents: number }

/** The order's settlement legs to its seller(s): one, or a consignment's consignor and vendor legs. Empty when unsettled. */
export async function sellerLegsOf(hawala: HawalaLedgerModuleService, orderId: string): Promise<SellerLeg[]> {
  return (await hawala.listLedgerEntries({ order_id: orderId, entry_type: "TRANSFER" }))
    .filter(
      (e) =>
        (e.status === "COMPLETED" || e.status === "REVERSED") &&
        typeof e.idempotency_key === "string" &&
        SELLER_SIDE_KEY.test(e.idempotency_key)
    )
    .map((e) => ({
      accountId: e.credit_account_id as string,
      tag: (e.idempotency_key as string).match(SELLER_SIDE_KEY)![2],
      cents: toCents(Number(e.amount)),
    }))
}

/** Every dispute-fee leg on an order, any status. */
export async function feeRowsOf(hawala: HawalaLedgerModuleService, orderId: string) {
  return (await hawala.listLedgerEntries({ reference_id: orderId, entry_type: "ADJUSTMENT" })).filter((e) =>
    isVendorDisputeFeeLeg(e)
  )
}

/** Cents of a charge's fee already recorded on an order (COMPLETED or PENDING legs). */
export function recordedOn(rows: Awaited<ReturnType<typeof feeRowsOf>>, chargeId: string): number {
  return rows
    .filter(
      (e) =>
        (e.status === "COMPLETED" || e.status === "PENDING") &&
        (e.metadata as { stripe_charge_id?: unknown } | null)?.stripe_charge_id === chargeId
    )
    .reduce((sum, e) => sum + toCents(Number(e.amount)), 0)
}

/**
 * Bring what an order owes of one charge's fee up to `targetCents`, split
 * across its seller legs, posting only the difference per leg. Throws on a
 * failed post; returns the cents posted. A target below what is recorded is
 * logged, never reversed.
 */
export async function postOrderFeeShare(
  hawala: HawalaLedgerModuleService,
  args: {
    orderId: string
    stripeChargeId: string
    targetCents: number
    sellerLegs: SellerLeg[]
    feeRows: Awaited<ReturnType<typeof feeRowsOf>>
    assignedBy?: string
  }
): Promise<number> {
  const { orderId, stripeChargeId, sellerLegs, feeRows } = args
  const legShares =
    sellerLegs.length === 1
      ? new Map([[sellerLegs[0].tag, args.targetCents]])
      : allocateCents(
          args.targetCents,
          sellerLegs.map((l) => ({ key: l.tag, weight: l.cents }))
        )
  let posted = 0
  for (const [tag, target] of legShares) {
    const leg = sellerLegs.find((l) => l.tag === tag)!
    const splitTag = sellerLegs.length > 1 ? tag : undefined
    const rows = feeRows.filter((e) => {
      const m = (e.metadata ?? {}) as { stripe_charge_id?: unknown; split_leg?: unknown }
      return m.stripe_charge_id === stripeChargeId && (m.split_leg ?? undefined) === splitTag
    })
    const live = rows.filter((e) => e.status === "COMPLETED" || e.status === "PENDING")
    for (const p of live.filter((e) => e.status === "PENDING")) {
      const age = Date.now() - new Date(p.created_at as unknown as string).getTime()
      if (age > STUCK_PENDING_MS) {
        log.error(`[Hawala] Card order ${orderId}: dispute-fee leg ${p.id} has been PENDING for ${Math.round(age / 60000)} min — needs a person`)
      }
    }
    const already = live.reduce((sum, e) => sum + toCents(Number(e.amount)), 0)
    if (target < already) {
      log.error(
        `[Hawala] Card order ${orderId}: the dispute fee on ${stripeChargeId} it owes is now ${target} cents, ` +
          `less than the ledger recorded (${already}); not reversed — needs a person`
      )
      continue
    }
    if (target === already) continue
    await hawala.recordDisputeFee({
      orderId,
      stripeChargeId,
      owedByAccountId: leg.accountId,
      amountCents: target - already,
      toCents: target,
      seq: rows.length,
      splitTag,
      ...(args.assignedBy ? { assignedBy: args.assignedBy } : {}),
    })
    posted += target - already
  }
  return posted
}

export async function postDisputeFees(
  container: Container,
  hawala: HawalaLedgerModuleService,
  order: CardSettlementOrder
): Promise<number> {
  let postedCents = 0
  try {
    const collectionId = order.payment_collection_ids[0]
    if (!collectionId) return 0
    const charges = (await hawala.listCardChargeStates({ payment_collection_id: collectionId })).filter(
      (c) => Number(c.dispute_fee_cents) > 0
    )
    if (charges.length === 0) return 0

    const attribution = await collectionWeights(container, collectionId)
    if (!attribution) {
      log.error(
        `[Hawala] Card order ${order.id}: a dispute fee on payment collection ${collectionId} cannot be attributed ` +
          `(the collection is shared and not every order has a split payment row); not posted to any seller — ` +
          `assign it at /admin/hawala/dispute-fees`
      )
      return 0
    }
    const sellerLegs = await sellerLegsOf(hawala, order.id)
    if (sellerLegs.length === 0) {
      log.warn(`[Hawala] Card order ${order.id}: not settled yet; its dispute fee posts once it is`)
      return 0
    }
    const feeRows = await feeRowsOf(hawala, order.id)
    for (const charge of charges) {
      try {
        if (String(charge.currency_code).toLowerCase() !== "usd") {
          log.error(`[Hawala] Card order ${order.id}: charge ${charge.stripe_charge_id} is not USD; its dispute fee is not posted`)
          continue
        }
        if (feeAssignmentOf(charge)) continue // the admin's (`lib/card-dispute-fee-assignment.ts`)
        if (!feeIsAutomatic(charge, attribution)) {
          log.error(
            `[Hawala] Card order ${order.id}: the dispute on charge ${charge.stripe_charge_id} covers ` +
              `${Number(charge.disputed_cents)} of ${Number(charge.amount_cents)} cents of a shared cart, so which order was ` +
              `disputed is unknown; its fee is not put on any seller — assign it at /admin/hawala/dispute-fees`
          )
          continue
        }
        const orderShare = allocateCents(Number(charge.dispute_fee_cents), attribution.weights).get(order.id) ?? 0
        postedCents += await postOrderFeeShare(hawala, {
          orderId: order.id,
          stripeChargeId: charge.stripe_charge_id,
          targetCents: orderShare,
          sellerLegs,
          feeRows,
        })
      } catch (error) {
        log.error(
          `[Hawala] Card order ${order.id}: could not post the dispute fee on ${charge.stripe_charge_id} (retried on the next run):`,
          error
        )
      }
    }
  } catch (error) {
    log.error(`[Hawala] Card order ${order.id}: could not post its dispute fee:`, error)
  }
  return postedCents
}
