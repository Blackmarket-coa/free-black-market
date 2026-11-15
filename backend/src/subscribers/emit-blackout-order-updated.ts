import { createLogger } from "../shared/logger"
const log = createLogger("subscribers/emit-blackout-order-updated")
import { SubscriberArgs, type SubscriberConfig } from "@medusajs/medusa"
import { emitBlackoutEvent } from "../lib/blackout-emit"
import { orderSellerId, resolveBlackoutUserId } from "../lib/blackout-identity"

/**
 * Emit §3 `order.updated` as fulfillment progresses. Maps Medusa fulfillment
 * lifecycle events onto the closed status set the vendor's order room expects:
 * fulfillment created -> dispatched, delivery created -> delivered.
 *
 * The event payload carries `order_id` (Medusa v2 fulfillment events); we
 * resolve seller/customer off the order. The seller is Mercur's link
 * (`seller.id`); an order with no seller link sends nothing, since the event
 * is only routed to a vendor's room. Best-effort + idempotent.
 */
export default async function emitBlackoutOrderUpdated({
  event,
  container,
}: SubscriberArgs<{ id?: string; order_id?: string; fulfillment_id?: string }>) {
  const orderId = event.data.order_id ?? event.data.id
  if (!orderId) return

  const status = event.name === "delivery.created" ? "delivered" : "dispatched"

  try {
    const query = container.resolve("query") as any
    const { data: orders } = await query.graph({
      entity: "order",
      // `seller.id` (Mercur's link), not `seller_id`, which Order does not
      // have: it read as absent and every event went to "default-seller".
      fields: ["id", "customer_id", "metadata", "seller.id"],
      filters: { id: orderId },
    })
    const order = orders?.[0]
    if (!order) return

    const sellerId = orderSellerId(order)
    if (!sellerId) {
      log.warn(`[emit-blackout-order-updated] order ${orderId} has no seller link; order.updated not sent`)
      return
    }
    // The buyer's id only, as before: the seller fallback inside
    // resolveBlackoutUserId never ran while `seller_id` read as absent, and
    // `userId` here names the buyer, not the vendor.
    const userId = await resolveBlackoutUserId(container, {
      customerId: order.customer_id ?? null,
      sellerId: null,
      orderMetadata: (order.metadata || {}) as Record<string, unknown>,
    })

    await emitBlackoutEvent(
      container,
      "order.updated",
      {
        vendorId: sellerId,
        ...(userId ? { userId } : {}),
        orderId,
        status,
      },
      { eventId: `order.updated:${orderId}:${status}` }
    )
  } catch (err) {
    log.error(`[emit-blackout-order-updated] failed for order ${orderId}:`, err)
  }
}

export const config: SubscriberConfig = {
  event: ["order.fulfillment_created", "delivery.created"],
}
