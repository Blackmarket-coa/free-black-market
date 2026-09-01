/**
 * Pure helpers for the in-app vendor order surface.
 *
 * `fulfillment_status` is NOT a column on the order — MercurJS computes it
 * per row from fulfillment timestamps in `getVendorOrdersListWorkflow`, so
 * it can't be filtered with a query param (passing one filters on a column
 * that doesn't exist). The vendor panel deals with this by filtering
 * client-side; we do the same, just server-side in the data layer.
 */

/** Values produced by MercurJS's `getLastFulfillmentStatus`. */
export type VendorFulfillmentStatus =
  | "not_fulfilled"
  | "partially_fulfilled"
  | "fulfilled"
  | "partially_shipped"
  | "shipped"
  | "delivered"
  | "partially_delivered"
  | "canceled"

export type VendorOrderStage =
  /** Came in, nothing packed yet. Packing needs a stock location — desktop. */
  | "awaiting_fulfillment"
  /** Packed and waiting on a tracking number — actionable on a phone. */
  | "ready_to_ship"
  /** Shipped, waiting on delivery confirmation — actionable on a phone. */
  | "in_transit"
  /** Delivered or cancelled — nothing left to do. */
  | "closed"

export type VendorOrderLike = {
  id: string
  status?: string | null
  fulfillment_status?: string | null
}

const STAGE_BY_FULFILLMENT_STATUS: Record<string, VendorOrderStage> = {
  not_fulfilled: "awaiting_fulfillment",
  partially_fulfilled: "awaiting_fulfillment",
  fulfilled: "ready_to_ship",
  partially_shipped: "ready_to_ship",
  shipped: "in_transit",
  partially_delivered: "in_transit",
  delivered: "closed",
  canceled: "closed",
}

/**
 * Which stage of the vendor's workflow an order sits in. A cancelled or
 * completed ORDER closes it regardless of fulfillment state — those two
 * status tracks are independent and the order-level one wins.
 */
export function vendorOrderStage(order: VendorOrderLike): VendorOrderStage {
  const orderStatus = (order.status ?? "").toLowerCase()
  if (orderStatus === "canceled" || orderStatus === "completed") {
    return "closed"
  }

  const fulfillment = (order.fulfillment_status ?? "").toLowerCase()
  return STAGE_BY_FULFILLMENT_STATUS[fulfillment] ?? "awaiting_fulfillment"
}

/** True when the vendor still owes this order something. */
export function needsVendorAction(order: VendorOrderLike): boolean {
  return vendorOrderStage(order) !== "closed"
}

/**
 * Can this stage be advanced from the phone? Packing is deliberately
 * excluded: creating a fulfillment requires a stock location and
 * per-line quantities backed by live inventory reservations, which fails
 * opaquely without them. Those orders are shown but hand off to the full
 * dashboard.
 */
export function isPhoneActionable(stage: VendorOrderStage): boolean {
  return stage === "ready_to_ship" || stage === "in_transit"
}

const STAGE_LABELS: Record<VendorOrderStage, string> = {
  awaiting_fulfillment: "Needs packing",
  ready_to_ship: "Ready to ship",
  in_transit: "In transit",
  closed: "Complete",
}

export function vendorOrderStageLabel(stage: VendorOrderStage): string {
  return STAGE_LABELS[stage]
}

/**
 * Sort for the phone list: open work first, oldest-first within that (the
 * order waiting longest is the most urgent), then closed orders
 * newest-first as a receipt log.
 */
export function sortForVendorInbox<T extends VendorOrderLike & { created_at?: string | null }>(
  orders: T[]
): T[] {
  const time = (value: string | null | undefined): number => {
    if (!value) return 0
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? 0 : parsed
  }

  return [...orders].sort((a, b) => {
    const aOpen = needsVendorAction(a)
    const bOpen = needsVendorAction(b)
    if (aOpen !== bOpen) return aOpen ? -1 : 1
    return aOpen
      ? time(a.created_at) - time(b.created_at)
      : time(b.created_at) - time(a.created_at)
  })
}

/**
 * The fulfillment a phone action should target: the newest one that is
 * neither cancelled nor already delivered. Returns null when there is
 * nothing to act on.
 */
export type VendorFulfillmentLike = {
  id: string
  packed_at?: string | null
  shipped_at?: string | null
  delivered_at?: string | null
  canceled_at?: string | null
  items?: Array<{ line_item_id?: string | null; quantity?: number | null }> | null
}

export type FulfillmentIntent = "ship" | "deliver"

/**
 * The fulfillment a phone action should target.
 *
 * Intent matters: a fulfillment that has already shipped is still "open"
 * in the sense that it is neither cancelled nor delivered, but posting a
 * second shipment against it is rejected by the backend. So shipping
 * looks for a packed-but-not-yet-shipped fulfillment, and delivering
 * looks for one that HAS shipped. Returns null when nothing matches,
 * which the caller turns into an explanatory message rather than a
 * failed request.
 */
export function actionableFulfillment(
  fulfillments: VendorFulfillmentLike[] | null | undefined,
  intent: FulfillmentIntent
): VendorFulfillmentLike | null {
  const live = (fulfillments ?? []).filter(
    (f) => !f.canceled_at && !f.delivered_at
  )
  const matching =
    intent === "ship"
      ? live.filter((f) => !f.shipped_at)
      : live.filter((f) => Boolean(f.shipped_at))

  if (matching.length === 0) return null
  return matching[matching.length - 1]
}

/**
 * Build the `items` array the shipment endpoint requires from a
 * fulfillment's own lines — the vendor is shipping exactly what was
 * packed, so the phone never asks them to re-enter quantities.
 */
export function shipmentItemsFor(
  fulfillment: VendorFulfillmentLike
): Array<{ id: string; quantity: number }> {
  return (fulfillment.items ?? [])
    .filter((item) => typeof item.line_item_id === "string" && item.line_item_id)
    .map((item) => ({
      id: item.line_item_id as string,
      quantity: Number(item.quantity) || 0,
    }))
    .filter((item) => item.quantity > 0)
}
