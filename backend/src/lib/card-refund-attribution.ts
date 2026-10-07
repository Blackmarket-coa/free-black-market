import { createLogger } from "../shared/logger"
const log = createLogger("lib/card-refund-attribution")
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { SPLIT_ORDER_PAYMENT_MODULE } from "@mercurjs/b2c-core/modules/split-order-payment"
import { HAWALA_LEDGER_MODULE } from "../modules/hawala-ledger"
import type HawalaLedgerModuleService from "../modules/hawala-ledger/service"
import { toCents } from "./card-order-settlement"
import { reconcileCardOrder, type CardOrderReconcileOutcome } from "./card-order-reconcile"

/**
 * Assigning a refund on a shared Mercur cart to the sellers' orders (SD-40;
 * operator answer 2026-10-06: "hold their payouts" until an admin assigns it).
 *
 * A Medusa-native refund (or an admin cancel) against a Mercur cart's shared
 * payment collection refunds the customer without touching any seller's
 * split row, so the ledger cannot tell whose sale was refunded; the
 * reconciler posts nothing and holds every seller on the collection
 * (`lib/card-order-reconcile.ts`). An admin reads the collection here, says
 * how the unassigned amount divides between its orders, and this records it
 * exactly as Mercur's own split refund would (`refunded_amount` and `status`
 * on each split row, `refundSplitOrderPaymentWorkflow`'s validation rule) —
 * WITHOUT calling Stripe: the customer has already been refunded. The
 * reconciler then posts each order's refund delta to that order's seller,
 * and the holds are released.
 *
 * The allocations must add up to the unassigned amount exactly, to the cent,
 * and no order may be refunded past what was captured for it. Serialized per
 * collection by an advisory lock, so two admins (or a retry) cannot assign
 * the same refund twice: the second sees no gap left and is refused.
 */

type Container = { resolve: (key: string) => unknown }

type QueryLike = {
  graph: (args: { entity: string; fields: string[]; filters: Record<string, unknown> }) => Promise<{ data: unknown[] }>
}

type SplitRow = {
  id: string
  status: string
  authorized_amount: number
  captured_amount: number
  refunded_amount: number
}

type SplitService = {
  listSplitOrderPayments: (filters: Record<string, unknown>) => Promise<SplitRow[]>
  updateSplitOrderPayments: (data: Array<Partial<SplitRow> & { id: string }>) => Promise<unknown>
}

export type CollectionRefundOrder = {
  order_id: string
  seller_id: string | null
  split_id: string
  /** Captured for this order, major units (the split's own, or its authorized amount once the collection is fully captured). */
  captured: number
  refunded: number
  /** captured - refunded: the most more that may be assigned to it. */
  refundable: number
}

export type CollectionRefundView = {
  payment_collection_id: string
  currency_code: string
  amount: number
  captured: number
  refunded: number
  /** Refunded on the collection but recorded on no split row, major units. */
  unassigned: number
  orders: CollectionRefundOrder[]
  active_hold_ids: string[]
}

export class RefundAttributionError extends Error {
  constructor(
    public readonly code: "not_found" | "not_shared" | "invalid_allocation" | "amount_mismatch" | "nothing_to_assign",
    message: string,
    public readonly details: Record<string, unknown> = {}
  ) {
    super(message)
    this.name = "RefundAttributionError"
  }
}

const num = (v: unknown): number => {
  const x = Number(v)
  return Number.isFinite(x) ? x : 0
}

/** The collection's money, per order, as the ledger reads it. Null when there is no such collection. */
export async function readCollectionRefunds(
  container: Container,
  paymentCollectionId: string
): Promise<CollectionRefundView | null> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY) as QueryLike
  const { data: collections } = await query.graph({
    entity: "payment_collection",
    fields: ["id", "currency_code", "amount", "captured_amount", "refunded_amount"],
    filters: { id: paymentCollectionId },
  })
  const c = (collections as Array<Record<string, unknown>>)[0]
  if (!c) return null

  const { data: splits } = await query.graph({
    entity: "split_order_payment",
    fields: ["id", "status", "authorized_amount", "captured_amount", "refunded_amount", "order.id", "order.seller.id"],
    filters: { payment_collection_id: paymentCollectionId },
  })
  const amount = num(c.amount)
  const captured = num(c.captured_amount)
  const refunded = num(c.refunded_amount)
  // Mercur captures the whole collection, then marks each split captured at
  // its authorized amount; read through that follow-up, as the ledger does.
  const fullyCaptured = amount > 0 && toCents(captured) >= toCents(amount)
  const orders: CollectionRefundOrder[] = (splits as Array<Record<string, unknown>>)
    .map((s) => {
      const order = s.order as { id?: string; seller?: { id?: string } | null } | null | undefined
      const splitCaptured = fullyCaptured ? num(s.authorized_amount) : num(s.captured_amount)
      const splitRefunded = num(s.refunded_amount)
      return {
        order_id: order?.id ?? "",
        seller_id: order?.seller?.id ?? null,
        split_id: String(s.id),
        captured: splitCaptured,
        refunded: splitRefunded,
        refundable: Math.max(0, toCents(splitCaptured) - toCents(splitRefunded)) / 100,
      }
    })
    .filter((o) => o.order_id)
  const recorded = orders.reduce((sum, o) => sum + toCents(o.refunded), 0)
  const hawala = container.resolve(HAWALA_LEDGER_MODULE) as HawalaLedgerModuleService
  const holds = await hawala.listPayoutHolds({ payment_collection_id: paymentCollectionId, status: "ACTIVE" })
  return {
    payment_collection_id: paymentCollectionId,
    currency_code: String(c.currency_code ?? "usd").toLowerCase(),
    amount,
    captured,
    refunded,
    unassigned: Math.max(0, toCents(refunded) - recorded) / 100,
    orders,
    active_hold_ids: holds.map((h) => h.id),
  }
}

type PgLike = {
  transaction?: <T>(work: (trx: { raw: (sql: string, b?: unknown[]) => Promise<unknown> }) => Promise<T>) => Promise<T>
}

async function withCollectionLock<T>(container: Container, collectionId: string, fn: () => Promise<T>): Promise<T> {
  let pg: PgLike | undefined
  try {
    pg = container.resolve(ContainerRegistrationKeys.PG_CONNECTION) as PgLike
  } catch {
    pg = undefined
  }
  if (!pg || typeof pg.transaction !== "function") return fn()
  return pg.transaction(async (trx) => {
    await trx.raw("SET LOCAL lock_timeout = '10s'")
    await trx.raw("SELECT pg_advisory_xact_lock(hashtext(?), hashtext(?))", ["hawala-card-collection", collectionId])
    return fn()
  })
}

export type RefundAttributionResult = {
  payment_collection_id: string
  assigned: Array<{ order_id: string; amount: number }>
  released_hold_ids: string[]
  reconciled: Array<{ order_id: string; outcome: CardOrderReconcileOutcome }>
}

/**
 * Record how the unassigned refund on a shared collection divides between
 * its orders, release the collection's holds, and post each order's refund
 * through the reconciler. Throws a RefundAttributionError (nothing written)
 * when the allocation is not exact.
 */
export async function attributeCollectionRefund(
  container: Container,
  args: {
    payment_collection_id: string
    allocations: Array<{ order_id: string; amount: number }>
    actor_id: string
  }
): Promise<RefundAttributionResult> {
  const collectionId = args.payment_collection_id
  const assigned = await withCollectionLock(container, collectionId, async () => {
    const view = await readCollectionRefunds(container, collectionId)
    if (!view) throw new RefundAttributionError("not_found", `No payment collection ${collectionId}`)
    if (view.orders.length === 0) {
      throw new RefundAttributionError(
        "not_shared",
        `Payment collection ${collectionId} has no split payment rows: its refunds are already per order`
      )
    }
    const gapCents = toCents(view.unassigned)
    if (gapCents <= 0) {
      throw new RefundAttributionError("nothing_to_assign", "Every refund on this collection is already assigned", {
        unassigned: 0,
      })
    }

    const byOrder = new Map(view.orders.map((o) => [o.order_id, o]))
    const seen = new Set<string>()
    let totalCents = 0
    for (const a of args.allocations) {
      const order = byOrder.get(a.order_id)
      const cents = toCents(a.amount)
      if (!order) {
        throw new RefundAttributionError("invalid_allocation", `Order ${a.order_id} is not on this collection`, {
          order_id: a.order_id,
        })
      }
      if (seen.has(a.order_id)) {
        throw new RefundAttributionError("invalid_allocation", `Order ${a.order_id} is listed twice`, {
          order_id: a.order_id,
        })
      }
      seen.add(a.order_id)
      if (!(cents > 0) || Math.abs(cents / 100 - a.amount) > 1e-9) {
        throw new RefundAttributionError("invalid_allocation", `Amount for ${a.order_id} must be positive, in cents`, {
          order_id: a.order_id,
        })
      }
      if (cents > toCents(order.refundable)) {
        throw new RefundAttributionError(
          "invalid_allocation",
          `Order ${a.order_id} can take at most ${order.refundable} more (captured ${order.captured}, refunded ${order.refunded})`,
          { order_id: a.order_id, refundable: order.refundable }
        )
      }
      totalCents += cents
    }
    if (totalCents !== gapCents) {
      throw new RefundAttributionError(
        "amount_mismatch",
        `The amounts add up to ${totalCents / 100}; the unassigned refund is ${gapCents / 100}`,
        { unassigned: gapCents / 100, allocated: totalCents / 100 }
      )
    }

    // As Mercur's own split refund records it (validateRefundSplitOrderPaymentStep):
    // refunded_amount grows by the amount; the status says whether anything
    // captured is left. No Stripe call: the customer was already refunded.
    const splits = container.resolve(SPLIT_ORDER_PAYMENT_MODULE) as SplitService
    await splits.updateSplitOrderPayments(
      args.allocations.map((a) => {
        const order = byOrder.get(a.order_id) as CollectionRefundOrder
        const refundedCents = toCents(order.refunded) + toCents(a.amount)
        return {
          id: order.split_id,
          refunded_amount: refundedCents / 100,
          status: toCents(order.captured) - refundedCents > 0 ? "partially_refunded" : "refunded",
        }
      })
    )
    log.warn(
      `[Hawala] Refund of ${gapCents / 100} on collection ${collectionId} assigned by ${args.actor_id}: ` +
        args.allocations.map((a) => `${a.order_id}=${a.amount}`).join(", ")
    )
    return args.allocations.map((a) => ({ order_id: a.order_id, amount: a.amount }))
  })

  const hawala = container.resolve(HAWALA_LEDGER_MODULE) as HawalaLedgerModuleService
  const released = await hawala.releasePayoutHolds({
    payment_collection_id: collectionId,
    released_by: args.actor_id,
    release_reason: "refund assigned to the sellers' orders by an admin",
  })
  const view = await readCollectionRefunds(container, collectionId)
  const reconciled: RefundAttributionResult["reconciled"] = []
  for (const o of view?.orders ?? []) {
    const { outcome } = await reconcileCardOrder(container, o.order_id)
    reconciled.push({ order_id: o.order_id, outcome })
  }
  return {
    payment_collection_id: collectionId,
    assigned,
    released_hold_ids: (released as Array<{ id: string }>).map((h) => h.id),
    reconciled,
  }
}
