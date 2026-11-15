import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"

/**
 * Medusa's order cancel acts on a whole payment collection (SD-36 (8)).
 *
 * `cancelOrderWorkflow` (@medusajs/core-flows, the workflow behind
 * `POST /admin/orders/:id/cancel`) reads the order's `payment_collections`
 * and, for every payment on them, refunds captured-minus-refunded
 * (`refundCapturedPaymentsWorkflow`), cancels it when nothing was captured
 * (`cancelPaymentStep`), and marks the collection `canceled`. It has no idea a
 * collection can belong to more than one order.
 *
 * Mercur's checkout (`split-and-complete-cart`) makes exactly that: one
 * payment collection per cart, linked to every seller's order, with a
 * `split_order_payment` row per order saying which part is whose. So an
 * admin cancel of ONE seller's order refunds (or voids) the whole cart at the
 * provider — the other sellers' money included — and none of the split rows
 * Mercur pays out from is touched. Seen on a real database: a $40 + $30 cart,
 * cancel of the $40 order, $70 refunded; Medusa's next step then fails
 * (`addOrderTransactionStep`: a shared collection has no single `order`), so
 * the route answers 500 and the order stays open with the refund already
 * gone. That failure follows any refund on a shared collection, which is why
 * a collection counts as shared while ANY other order is on it, canceled or
 * not.
 *
 * Mercur's own split-aware cancel (`POST /vendor/orders/:id/cancel`,
 * `refundSplitOrderPaymentWorkflow`) refunds only the order's split and
 * records it against that order, but it is not a drop-in: it needs the split
 * captured (it refuses a zero amount), skips Medusa's `orderCanceled` hook
 * (FBM's rental check), and leaves the collection alone. So FBM does not
 * reroute an admin cancel through it; it refuses, and says what to do
 * instead. A collection that belongs to one order (every single-seller cart)
 * is never shared, and its cancel is Medusa's, unchanged.
 */

export const SHARED_PAYMENT_CANCEL_REFUSED = "shared_payment_collection" as const

/** A payment collection of the order that other orders also pay through. */
export type SharedPaymentCollection = {
  payment_collection_id: string
  /** The other orders on it, by link or by split row. */
  other_order_ids: string[]
}

type Resolver = { resolve: (key: string) => unknown }

type QueryGraph = {
  graph: (args: {
    entity: string
    fields: string[]
    filters: Record<string, unknown>
  }) => Promise<{ data: unknown[] }>
}

type Row = Record<string, unknown>

/**
 * The order's payment collections that other orders also pay through. Empty
 * when a Medusa cancel would touch only this order's money.
 *
 * Read from both places a collection's owners are recorded: the core
 * order↔payment-collection link (what Medusa's cancel itself reads) and
 * Mercur's split rows (what Mercur pays sellers from), so a cart whose link
 * rows and split rows disagree is still caught.
 */
export async function findOrdersSharingPayment(
  container: Resolver,
  orderId: string
): Promise<SharedPaymentCollection[]> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY) as QueryGraph

  const { data: own } = await query.graph({
    entity: "order_payment_collection",
    fields: ["order_id", "payment_collection_id"],
    filters: { order_id: orderId },
  })
  const collectionIds = [
    ...new Set(
      (own as Row[])
        .map((r) => r?.payment_collection_id)
        .filter((v): v is string => typeof v === "string" && v.length > 0)
    ),
  ]
  if (collectionIds.length === 0) return []

  const [{ data: linked }, { data: splits }] = await Promise.all([
    query.graph({
      entity: "order_payment_collection",
      fields: ["order_id", "payment_collection_id"],
      filters: { payment_collection_id: collectionIds },
    }),
    query.graph({
      entity: "split_order_payment",
      fields: ["id", "payment_collection_id", "order.id"],
      filters: { payment_collection_id: collectionIds },
    }),
  ])

  const others = new Map<string, Set<string>>(collectionIds.map((id) => [id, new Set<string>()]))
  const note = (collectionId: unknown, otherId: unknown) => {
    if (typeof collectionId !== "string" || typeof otherId !== "string") return
    if (!otherId || otherId === orderId) return
    others.get(collectionId)?.add(otherId)
  }
  for (const row of linked as Row[]) note(row?.payment_collection_id, row?.order_id)
  for (const row of splits as Row[]) note(row?.payment_collection_id, (row?.order as Row | null | undefined)?.id)

  return collectionIds
    .map((payment_collection_id) => ({
      payment_collection_id,
      other_order_ids: [...(others.get(payment_collection_id) ?? [])].sort(),
    }))
    .filter((c) => c.other_order_ids.length > 0)
}

/** What an admin is told when the cancel is refused. */
export function sharedPaymentCancelMessage(orderId: string, shared: SharedPaymentCollection[]): string {
  const others = [...new Set(shared.flatMap((c) => c.other_order_ids))].sort()
  return (
    `Order ${orderId} cannot be canceled here: it was paid in one payment together with ` +
    `${others.length} other order${others.length === 1 ? "" : "s"} from the same cart (${others.join(", ")}), ` +
    `and this cancel would refund or void that whole payment, the other sellers' money included. ` +
    `Have the seller cancel it from the vendor panel instead, which refunds only this order's share. ` +
    `That needs the payment captured; if it is only authorized, capture it first.`
  )
}

/** The refusal as an error, for code that runs Medusa's cancel itself (not over HTTP). */
export class SharedPaymentCancelRefusedError extends MedusaError {
  readonly order_id: string
  readonly shared_payment_collections: SharedPaymentCollection[]

  constructor(orderId: string, shared: SharedPaymentCollection[]) {
    super(MedusaError.Types.NOT_ALLOWED, sharedPaymentCancelMessage(orderId, shared), SHARED_PAYMENT_CANCEL_REFUSED)
    this.order_id = orderId
    this.shared_payment_collections = shared
  }
}

/**
 * Throws `SharedPaymentCancelRefusedError` when running Medusa's
 * `cancelOrderWorkflow` on this order would refund or void money that other
 * orders paid through the same collection. Call it before every FBM call of
 * that workflow.
 */
export async function assertCancelLeavesSharedPaymentAlone(container: Resolver, orderId: string): Promise<void> {
  const shared = await findOrdersSharingPayment(container, orderId)
  if (shared.length > 0) throw new SharedPaymentCancelRefusedError(orderId, shared)
}
