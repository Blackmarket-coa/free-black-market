import { createLogger } from "../shared/logger"
const log = createLogger("subscribers/native-push-order-placed")
import { SubscriberArgs, type SubscriberConfig } from "@medusajs/medusa"
import { NATIVE_PUSH_MODULE } from "../modules/native-push"
import type NativePushModuleService from "../modules/native-push/service"
import { itemCount, pushToOrderSeller } from "../shared/native-push-seller"

/**
 * Subscriber: push an order confirmation to the buyer, and a "new order"
 * alert to the seller, on the FBM Capacitor shell.
 *
 * MercurJS splits a multi-seller cart so `order.placed` already fires once
 * per seller-order — so the seller push here is naturally scoped to the
 * seller who actually received the order, with no fan-out of its own.
 *
 * Every exit is soft: no customer on the order, no linked seller, no
 * registered devices, or FCM unconfigured (FCM_SERVICE_ACCOUNT_JSON unset)
 * all no-op without failing the event.
 */
export default async function nativePushOrderPlacedSubscriber({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  // Seller leg first and independently: a buyer-side miss (guest checkout,
  // no devices) must not stop the vendor from being told they have work.
  await pushToOrderSeller(container, data.id, (order) => {
    const units = itemCount(order)
    return {
      title: "New order",
      body: `Order #${order.display_id ?? order.id}${
        units > 0 ? ` · ${units} item${units === 1 ? "" : "s"}` : ""
      } is ready to fulfill.`,
      data: {
        type: "order.placed.seller",
        order_id: String(order.id),
        path: `/vendor/orders/${order.id}`,
      },
    }
  })

  let nativePush: NativePushModuleService
  try {
    nativePush = container.resolve<NativePushModuleService>(NATIVE_PUSH_MODULE)
  } catch {
    return
  }

  if (!nativePush.isSendingConfigured()) {
    return
  }

  try {
    const query = container.resolve("query") as any
    const { data: orders } = await query.graph({
      entity: "order",
      fields: ["id", "display_id", "customer_id", "total", "currency_code"],
      filters: { id: data.id },
    })

    const order = orders?.[0]
    if (!order?.customer_id) {
      return
    }

    const summary = await nativePush.sendToCustomer(order.customer_id, {
      title: "Order confirmed",
      body: `Order #${order.display_id ?? order.id} is confirmed — thanks for buying from the coalition.`,
      data: {
        type: "order.placed",
        order_id: String(order.id),
        // NativeAppBridge routes fbm://open?path=… deep links; the push
        // handler can reuse this path client-side.
        path: "/user/orders",
      },
    })

    if (summary.sent.length > 0 || summary.failed.length > 0) {
      log.info(
        `order ${order.id}: push sent=${summary.sent.length} invalid=${summary.invalid.length} failed=${summary.failed.length}`
      )
    }
  } catch (error) {
    // Push delivery must never fail order placement side effects.
    log.error("native push for order.placed failed", error)
  }
}

export const config: SubscriberConfig = {
  event: "order.placed",
}
