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

/** Each order's weight on a collection, or null when the money cannot be attributed. */
async function orderWeights(
  container: Container,
  collectionId: string,
  orderId: string
): Promise<{ weights: Array<{ key: string; weight: number }>; shared: boolean } | null> {
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
  return sharers.length === 1 && sharers[0] === orderId ? { weights: [{ key: orderId, weight: 1 }], shared: false } : null
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

    const attribution = await orderWeights(container, collectionId, order.id)
    if (!attribution) {
      log.error(
        `[Hawala] Card order ${order.id}: a dispute fee on payment collection ${collectionId} cannot be attributed ` +
          `(the collection is shared with no split payment rows); not posted to any seller — needs a person`
      )
      return 0
    }
    const sellerLegs = (await hawala.listLedgerEntries({ order_id: order.id, entry_type: "TRANSFER" }))
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
    if (sellerLegs.length === 0) {
      log.warn(`[Hawala] Card order ${order.id}: not settled yet; its dispute fee posts once it is`)
      return 0
    }
    const legShares = (cents: number) =>
      sellerLegs.length === 1
        ? new Map([[sellerLegs[0].tag, cents]])
        : allocateCents(
            cents,
            sellerLegs.map((l) => ({ key: l.tag, weight: l.cents }))
          )

    const feeRows = (await hawala.listLedgerEntries({ reference_id: order.id, entry_type: "ADJUSTMENT" })).filter((e) =>
      isVendorDisputeFeeLeg(e)
    )
    for (const charge of charges) {
      try {
        if (String(charge.currency_code).toLowerCase() !== "usd") {
          log.error(`[Hawala] Card order ${order.id}: charge ${charge.stripe_charge_id} is not USD; its dispute fee is not posted`)
          continue
        }
        if (attribution.shared && Number(charge.disputed_cents) < Number(charge.amount_cents)) {
          log.error(
            `[Hawala] Card order ${order.id}: the dispute on charge ${charge.stripe_charge_id} covers ` +
              `${Number(charge.disputed_cents)} of ${Number(charge.amount_cents)} cents of a shared cart, so which order was ` +
              `disputed is unknown; its fee is not put on any seller — needs a person`
          )
          continue
        }
        const orderShare = allocateCents(Number(charge.dispute_fee_cents), attribution.weights).get(order.id) ?? 0
        for (const [tag, target] of legShares(orderShare)) {
          const leg = sellerLegs.find((l) => l.tag === tag)!
          const splitTag = sellerLegs.length > 1 ? tag : undefined
          const rows = feeRows.filter((e) => {
            const m = (e.metadata ?? {}) as { stripe_charge_id?: unknown; split_leg?: unknown }
            return m.stripe_charge_id === charge.stripe_charge_id && (m.split_leg ?? undefined) === splitTag
          })
          const live = rows.filter((e) => e.status === "COMPLETED" || e.status === "PENDING")
          for (const p of live.filter((e) => e.status === "PENDING")) {
            const age = Date.now() - new Date(p.created_at as unknown as string).getTime()
            if (age > STUCK_PENDING_MS) {
              log.error(`[Hawala] Card order ${order.id}: dispute-fee leg ${p.id} has been PENDING for ${Math.round(age / 60000)} min — needs a person`)
            }
          }
          const already = live.reduce((sum, e) => sum + toCents(Number(e.amount)), 0)
          if (target < already) {
            log.error(
              `[Hawala] Card order ${order.id}: Stripe now reports less dispute fee on ${charge.stripe_charge_id} ` +
                `(${target} cents) than the ledger recorded (${already}); not reversed — needs a person`
            )
            continue
          }
          if (target === already) continue
          await hawala.recordDisputeFee({
            orderId: order.id,
            stripeChargeId: charge.stripe_charge_id,
            owedByAccountId: leg.accountId,
            amountCents: target - already,
            toCents: target,
            seq: rows.length,
            splitTag,
          })
          postedCents += target - already
        }
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
