import { createLogger } from "../shared/logger"
const log = createLogger("lib/card-dispute-fee-assignment")
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { HAWALA_LEDGER_MODULE } from "../modules/hawala-ledger"
import type HawalaLedgerModuleService from "../modules/hawala-ledger/service"
import { VENDOR_DISPUTE_FEE_LEG } from "../modules/hawala-ledger/vendor-receivable"
import { ordersForPaymentCollection, toCents } from "./card-order-settlement"
import {
  collectionWeights,
  feeAssignmentOf,
  feeIsAutomatic,
  feeRowsOf,
  postOrderFeeShare,
  recordedOn,
  sellerLegsOf,
  type FeeAssignmentRecord,
} from "./card-dispute-fee"

/**
 * An admin assigns a Stripe dispute fee that the automatic rule would not put
 * on anyone (SD-44 open item (a); operator, 2026-10-08: "build it").
 *
 * The rule (`lib/card-dispute-fee.ts`): the vendor whose order was disputed
 * owes the fee. On a Mercur cart one charge pays several sellers' orders, and
 * a PARTIAL chargeback does not say which order the cardholder disputed, so
 * nothing is put on any seller automatically — nor on a cart where an order
 * lacks a split row. Those fees queue here. A person who knows (from the
 * dispute's reason and evidence in Stripe) says how the unassigned fee
 * divides between the cart's orders, and may leave part or all of it with
 * BMC ("BMC absorbs"). The amounts must add up to the unassigned fee to the
 * cent. Each share posts through the same guarded path as an automatic fee
 * (`postOrderFeeShare` → `recordDisputeFee`, the internal-only receivable
 * leg), stamped with the admin who assigned it, and is recovered and forgiven
 * like any other chargeback fee.
 *
 * From the first assignment, the charge is the admin's: the automatic path
 * skips it for good (`metadata.fee_assignment` on its charge state), so a
 * later re-read can never put a second, automatic share on top. If Stripe
 * later reports a larger fee (a second chargeback), the difference returns to
 * this queue.
 *
 * Serialized per charge by an advisory lock, so two admins (or a retry)
 * cannot assign the same fee twice: the second sees nothing left and is
 * refused. Nothing here calls Stripe.
 */

type Container = { resolve: (key: string) => unknown }
type PgLike = {
  raw: (sql: string, b?: unknown[]) => Promise<{ rows?: Array<Record<string, unknown>> }>
  transaction?: <T>(work: (trx: { raw: (sql: string, b?: unknown[]) => Promise<unknown> }) => Promise<T>) => Promise<T>
}

export type DisputeFeeQueueReason = "partial_chargeback" | "missing_split_rows" | "assigned_in_part"

export type DisputeFeeOrderView = {
  order_id: string
  seller_id: string | null
  seller_name: string | null
  /** The order's authorised amount on its split row, major units; null without one. */
  order_amount: number | null
  /** Settled into the ledger: only a settled order has a seller account to owe the fee. */
  settled: boolean
  /** Cents of this charge's fee already owed on this order. */
  assigned_cents: number
}

export type DisputeFeeView = {
  stripe_charge_id: string
  payment_collection_id: string
  currency_code: string
  charge_amount_cents: number
  /** The largest single chargeback on the charge, cents. */
  disputed_cents: number
  fee_cents: number
  /** Owed by sellers so far, cents. */
  assigned_cents: number
  /** Left with BMC by an admin, cents. */
  absorbed_cents: number
  /** fee - assigned - absorbed. */
  unassigned_cents: number
  /**
   * Why it needs a person; null when the automatic rule decides it.
   * `partial_chargeback`: a cart, and no one chargeback covered it whole.
   * `missing_split_rows`: a cart where an order has no split row.
   * `assigned_in_part`: an admin has assigned it before and something is left
   * (a later, larger fee, or an assignment that did not finish posting).
   */
  reason: DisputeFeeQueueReason | null
  orders: DisputeFeeOrderView[]
  assignment: FeeAssignmentRecord | null
}

export class DisputeFeeAssignmentError extends Error {
  constructor(
    public readonly code:
      | "not_found"
      | "automatic"
      | "nothing_to_assign"
      | "invalid_allocation"
      | "amount_mismatch"
      | "order_not_settled",
    message: string,
    public readonly details: Record<string, unknown> = {}
  ) {
    super(message)
    this.name = "DisputeFeeAssignmentError"
  }
}

const hawalaOf = (container: Container) => container.resolve(HAWALA_LEDGER_MODULE) as HawalaLedgerModuleService

async function chargeState(container: Container, chargeId: string) {
  const [row] = await hawalaOf(container).listCardChargeStates({ stripe_charge_id: chargeId })
  return row ?? null
}

/** Cents of each charge's fee owed by sellers, across every order (COMPLETED or PENDING legs). */
async function assignedByCharge(container: Container, chargeIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (chargeIds.length === 0) return out
  const pg = container.resolve(ContainerRegistrationKeys.PG_CONNECTION) as PgLike
  const result = await pg.raw(
    `SELECT metadata->>'stripe_charge_id' AS charge_id, SUM(amount) AS total
       FROM hawala_ledger_entry
      WHERE entry_type = 'ADJUSTMENT'
        AND metadata->>'leg' = ?
        AND metadata->>'stripe_charge_id' = ANY(?)
        AND status IN ('COMPLETED', 'PENDING')
        AND deleted_at IS NULL
      GROUP BY 1`,
    [VENDOR_DISPUTE_FEE_LEG, chargeIds]
  )
  for (const r of result?.rows ?? []) out.set(String(r.charge_id), toCents(Number(r.total)))
  return out
}

async function sellersOf(container: Container, orderIds: string[]) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY) as {
    graph: (q: { entity: string; fields: string[]; filters: Record<string, unknown> }) => Promise<{ data: unknown[] }>
  }
  if (orderIds.length === 0) return new Map<string, { id: string | null; name: string | null }>()
  const { data } = await query.graph({ entity: "order", fields: ["id", "seller.id", "seller.name"], filters: { id: orderIds } })
  return new Map(
    (data as Array<{ id: string; seller?: { id?: string; name?: string } | null }>).map((o) => [
      o.id,
      { id: o.seller?.id ?? null, name: o.seller?.name ?? null },
    ])
  )
}

async function splitAmounts(container: Container, collectionId: string): Promise<Map<string, number>> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY) as {
    graph: (q: { entity: string; fields: string[]; filters: Record<string, unknown> }) => Promise<{ data: unknown[] }>
  }
  const { data } = await query.graph({
    entity: "split_order_payment",
    fields: ["id", "authorized_amount", "order.id"],
    filters: { payment_collection_id: collectionId },
  })
  return new Map(
    (data as Array<{ authorized_amount?: unknown; order?: { id?: string } | null }>)
      .filter((s) => typeof s.order?.id === "string")
      .map((s) => [s.order!.id as string, Number(s.authorized_amount)])
  )
}

/** One charge's fee: who owes what so far, and what is left for a person. */
export async function readDisputeFee(container: Container, chargeId: string): Promise<DisputeFeeView | null> {
  const charge = await chargeState(container, chargeId)
  if (!charge || !(Number(charge.dispute_fee_cents) > 0)) return null
  const hawala = hawalaOf(container)
  const collectionId = charge.payment_collection_id
  const attribution = await collectionWeights(container as never, collectionId)
  const orderIds = await ordersForPaymentCollection(container as never, collectionId)
  const [sellers, amounts] = await Promise.all([sellersOf(container, orderIds), splitAmounts(container, collectionId)])
  const orders: DisputeFeeOrderView[] = []
  for (const orderId of orderIds) {
    const [legs, rows] = await Promise.all([sellerLegsOf(hawala, orderId), feeRowsOf(hawala, orderId)])
    orders.push({
      order_id: orderId,
      seller_id: sellers.get(orderId)?.id ?? null,
      seller_name: sellers.get(orderId)?.name ?? null,
      order_amount: amounts.has(orderId) ? amounts.get(orderId)! : null,
      settled: legs.length > 0,
      assigned_cents: recordedOn(rows, charge.stripe_charge_id),
    })
  }
  const assignment = feeAssignmentOf(charge)
  const fee = Number(charge.dispute_fee_cents)
  const assigned = orders.reduce((sum, o) => sum + o.assigned_cents, 0)
  const absorbed = assignment?.absorbed_cents ?? 0
  const unassigned = Math.max(0, fee - assigned - absorbed)
  const reason: DisputeFeeQueueReason | null = feeIsAutomatic(charge, attribution)
    ? null
    : assignment
      ? "assigned_in_part"
      : attribution
        ? "partial_chargeback"
        : "missing_split_rows"
  return {
    stripe_charge_id: charge.stripe_charge_id,
    payment_collection_id: collectionId,
    currency_code: String(charge.currency_code).toLowerCase(),
    charge_amount_cents: Number(charge.amount_cents),
    disputed_cents: Number(charge.disputed_cents),
    fee_cents: fee,
    assigned_cents: assigned,
    absorbed_cents: absorbed,
    unassigned_cents: unassigned,
    reason,
    orders,
    assignment,
  }
}

/**
 * Every fee that needs a person: not automatic, with something unassigned.
 * Oldest first. Bounded: charges with a dispute fee are rare, and each is
 * read once.
 */
export async function listUnassignedDisputeFees(container: Container): Promise<DisputeFeeView[]> {
  const charges = (await hawalaOf(container).listCardChargeStates(
    { dispute_fee_cents: { $gt: 0 } },
    { order: { created_at: "ASC" } }
  )) as Array<{ stripe_charge_id: string; dispute_fee_cents: unknown; metadata?: unknown }>
  const assigned = await assignedByCharge(
    container,
    charges.map((c) => c.stripe_charge_id)
  )
  const out: DisputeFeeView[] = []
  for (const c of charges) {
    const absorbed = feeAssignmentOf(c)?.absorbed_cents ?? 0
    if (Number(c.dispute_fee_cents) - (assigned.get(c.stripe_charge_id) ?? 0) - absorbed <= 0) continue
    const view = await readDisputeFee(container, c.stripe_charge_id)
    if (view && view.reason && view.unassigned_cents > 0) out.push(view)
  }
  return out
}

async function withChargeLock<T>(container: Container, chargeId: string, fn: () => Promise<T>): Promise<T> {
  let pg: PgLike | undefined
  try {
    pg = container.resolve(ContainerRegistrationKeys.PG_CONNECTION) as PgLike
  } catch {
    pg = undefined
  }
  if (!pg || typeof pg.transaction !== "function") return fn()
  return pg.transaction(async (trx) => {
    await trx.raw("SET LOCAL lock_timeout = '10s'")
    await trx.raw("SELECT pg_advisory_xact_lock(hashtext(?), hashtext(?))", ["hawala-dispute-fee", chargeId])
    return fn()
  })
}

export type DisputeFeeAssignmentResult = {
  stripe_charge_id: string
  posted: Array<{ order_id: string; cents: number }>
  absorbed_cents: number
  unassigned_cents: number
}

/**
 * Assign a charge's unassigned fee: `allocations` (major units) to orders on
 * its cart, and optionally `bmc_absorbs` (major units) left with BMC. They
 * must add up to the unassigned fee to the cent.
 */
export async function assignDisputeFee(
  container: Container,
  args: {
    stripe_charge_id: string
    allocations: Array<{ order_id: string; amount: number }>
    bmc_absorbs?: number
    actor_id: string
  }
): Promise<DisputeFeeAssignmentResult> {
  const chargeId = args.stripe_charge_id
  return withChargeLock(container, chargeId, async () => {
    const view = await readDisputeFee(container, chargeId)
    if (!view) throw new DisputeFeeAssignmentError("not_found", `No dispute fee is recorded on charge ${chargeId}`)
    if (!view.reason) {
      throw new DisputeFeeAssignmentError(
        "automatic",
        "This fee is assigned automatically: one order, or one chargeback covering the whole cart"
      )
    }
    if (view.currency_code !== "usd") {
      throw new DisputeFeeAssignmentError("invalid_allocation", "Only a USD charge's fee can be assigned")
    }
    if (view.unassigned_cents <= 0) {
      throw new DisputeFeeAssignmentError("nothing_to_assign", "Nothing is left to assign on this charge", {
        fee_cents: view.fee_cents,
        assigned_cents: view.assigned_cents,
        absorbed_cents: view.absorbed_cents,
      })
    }
    const byOrder = new Map(view.orders.map((o) => [o.order_id, o]))
    const seen = new Set<string>()
    const allocations = args.allocations.map((a) => {
      if (seen.has(a.order_id)) {
        throw new DisputeFeeAssignmentError("invalid_allocation", `Order ${a.order_id} appears twice`)
      }
      seen.add(a.order_id)
      const order = byOrder.get(a.order_id)
      if (!order) {
        throw new DisputeFeeAssignmentError("invalid_allocation", `Order ${a.order_id} is not on this charge's cart`)
      }
      if (!order.settled) {
        throw new DisputeFeeAssignmentError(
          "order_not_settled",
          `Order ${a.order_id} has not reached the ledger yet, so it has no seller account to owe the fee`
        )
      }
      const cents = toCents(a.amount)
      if (!(cents > 0)) throw new DisputeFeeAssignmentError("invalid_allocation", `Order ${a.order_id}: the amount must be positive`)
      return { order_id: a.order_id, cents }
    })
    const absorbedNow = args.bmc_absorbs !== undefined ? toCents(args.bmc_absorbs) : 0
    if (absorbedNow < 0) throw new DisputeFeeAssignmentError("invalid_allocation", "BMC's part cannot be negative")
    const total = allocations.reduce((s, a) => s + a.cents, 0) + absorbedNow
    if (total !== view.unassigned_cents) {
      throw new DisputeFeeAssignmentError(
        "amount_mismatch",
        `The amounts add up to ${total / 100}, but ${view.unassigned_cents / 100} is unassigned`,
        { unassigned_cents: view.unassigned_cents, total_cents: total }
      )
    }

    // The charge is the admin's from here: recorded BEFORE any leg posts, so
    // a re-read racing this can never add an automatic share on top.
    const hawala = hawalaOf(container)
    const charge = (await chargeState(container, chargeId))!
    const now = new Date().toISOString()
    const prior = feeAssignmentOf(charge)
    const record: FeeAssignmentRecord = {
      assigned_by: args.actor_id,
      assigned_at: now,
      absorbed_cents: (prior?.absorbed_cents ?? 0) + absorbedNow,
      history: [
        ...(prior?.history ?? []),
        { by: args.actor_id, at: now, allocations, absorbed_cents: absorbedNow },
      ],
    }
    await hawala.updateCardChargeStates({
      id: charge.id,
      metadata: { ...((charge.metadata as Record<string, unknown> | null) ?? {}), fee_assignment: record },
    })

    const posted: Array<{ order_id: string; cents: number }> = []
    for (const a of allocations) {
      const [legs, rows] = await Promise.all([sellerLegsOf(hawala, a.order_id), feeRowsOf(hawala, a.order_id)])
      const cents = await postOrderFeeShare(hawala, {
        orderId: a.order_id,
        stripeChargeId: chargeId,
        targetCents: recordedOn(rows, chargeId) + a.cents,
        sellerLegs: legs,
        feeRows: rows,
        assignedBy: args.actor_id,
      })
      posted.push({ order_id: a.order_id, cents })
    }
    const after = await readDisputeFee(container, chargeId)
    log.info(
      `[Hawala] Dispute fee on ${chargeId} assigned by ${args.actor_id}: ` +
        `${posted.map((p) => `${p.order_id} ${p.cents}`).join(", ") || "none to sellers"}; BMC absorbs ${absorbedNow}`
    )
    return {
      stripe_charge_id: chargeId,
      posted,
      absorbed_cents: record.absorbed_cents,
      unassigned_cents: after?.unassigned_cents ?? 0,
    }
  })
}
