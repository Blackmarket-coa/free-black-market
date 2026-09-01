import { SubscriberArgs, type SubscriberConfig } from "@medusajs/medusa"
import { itemCount, pushToOrderSeller } from "../shared/native-push-seller"

/**
 * Subscriber: tell the seller their order was cancelled.
 *
 * This is the second-most time-critical seller signal after a new order —
 * a vendor may already be picking or packing, and every minute of delay is
 * wasted work. Buyer-side cancellation messaging stays with the existing
 * email/notification paths; this is purely the mobile transport for the
 * seller.
 *
 * Soft on every failure, like the order.placed sibling.
 */
export default async function nativePushOrderCanceledSubscriber({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  await pushToOrderSeller(container, data.id, (order) => {
    const units = itemCount(order)
    return {
      title: "Order cancelled",
      body: `Order #${order.display_id ?? order.id}${
        units > 0 ? ` · ${units} item${units === 1 ? "" : "s"}` : ""
      } was cancelled — stop fulfillment if you have started.`,
      data: {
        type: "order.canceled.seller",
        order_id: String(order.id),
        path: `/vendor/orders/${order.id}`,
      },
    }
  })
}

export const config: SubscriberConfig = {
  event: "order.canceled",
}
