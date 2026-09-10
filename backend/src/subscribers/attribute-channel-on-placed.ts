import { createLogger } from "../shared/logger"
const log = createLogger("subscribers/attribute-channel-on-placed")
import { SubscriberArgs, type SubscriberConfig } from "@medusajs/medusa"
import { ORDER_CHANNEL_MODULE } from "../modules/order-channel"
import type OrderChannelService from "../modules/order-channel/service"
import { resolveOrderChannel } from "../modules/order-channel/resolver"
import { getOrderCartMetadata } from "../lib/cart-metadata-recovery"

/**
 * Record first-class channel attribution for every placed order (roadmap
 * Phase 3A). Resolution order: explicit `metadata.order_channel` stamp
 * (written pre-completion via `POST /store/carts/:id/channel` or at
 * order-creation time by server-side flows) → subscription provenance →
 * default `online`. Idempotent — duplicate `order.placed` events return
 * the existing row (unique on order_id).
 *
 * The stamp is recovered from the cart when the order does not carry it.
 * `POST /store/carts/:id/channel` writes `order_channel` onto **cart**
 * metadata on the stated expectation that it propagates at completion, and
 * on FBM's main checkout path it does not — `splitAndCompleteCartWorkflow`
 * drops cart metadata (see `lib/cart-metadata-recovery.ts` and D9-5). Read
 * straight off the order, every POS, vending and pickup sale silently
 * resolved to the `online` default, which is worse than an absent number:
 * the channel report looked complete and was wrong.
 */
export default async function attributeChannelOnPlaced({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const orderId = data.id

  try {
    const query = container.resolve("query") as any
    const { data: orders } = await query.graph({
      entity: "order",
      fields: ["id", "customer_id", "metadata"],
      filters: { id: orderId },
    })
    const order = orders?.[0]
    if (!order) return

    const resolved = resolveOrderChannel({
      metadata: await getOrderCartMetadata(container, order, ["order_channel"]),
    })

    const channels = container.resolve<OrderChannelService>(ORDER_CHANNEL_MODULE)
    await channels.setChannelForOrder({
      order_id: orderId,
      channel: resolved.channel,
      source: resolved.source,
      customer_id: order.customer_id ?? null,
    })
  } catch (err) {
    // Never fail order placement because channel attribution failed.
    log.error(`[attribute-channel-on-placed] failed for order ${orderId}:`, err)
  }
}

export const config: SubscriberConfig = {
  event: "order.placed",
}
