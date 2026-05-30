import { SubscriberArgs, type SubscriberConfig } from "@medusajs/medusa"
import { emitBlackoutEvent } from "../lib/blackout-emit"
import { resolveBlackoutUserId } from "../lib/blackout-identity"

/**
 * Emit §3 `order.updated` as fulfillment progresses. Maps Medusa fulfillment
 * lifecycle events onto the closed status set the vendor's order room expects:
 * fulfillment created -> dispatched, delivery created -> delivered.
 *
 * The event payload carries `order_id` (Medusa v2 fulfillment events); we
 * resolve seller/customer off the order. Best-effort + idempotent.
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
      fields: ["id", "customer_id", "metadata", "seller_id"],
      filters: { id: orderId },
    })
    const order = orders?.[0]
    if (!order) return

    const sellerId = (order as any).seller_id || "default-seller"
    const userId = await resolveBlackoutUserId(container, {
      customerId: order.customer_id ?? null,
      sellerId: (order as any).seller_id ?? null,
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
    console.error(`[emit-blackout-order-updated] failed for order ${orderId}:`, err)
  }
}

export const config: SubscriberConfig = {
  event: ["order.fulfillment_created", "delivery.created"],
}
