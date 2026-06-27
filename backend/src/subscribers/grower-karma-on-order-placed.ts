import { createLogger } from "../shared/logger"
const log = createLogger("subscribers/grower-karma-on-order-placed")
import { SubscriberArgs, type SubscriberConfig } from "@medusajs/medusa"
import { GrowerKarmaService } from "../modules/progression/grower-karma"
import { loadOrderNodeContext } from "../modules/agriculture/plant-order-helpers"

/**
 * Plant Network — award PRODUCER (grower) KARMA for units sold when an order is
 * placed. One `units_sold` event per grower line item, weighted by quantity.
 * Isolated by try/catch; additive only (never blocks the order).
 */
export default async function growerKarmaOnOrderPlaced({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  try {
    const ctx = await loadOrderNodeContext(container, data.id)
    if (!ctx) return

    const karma = new GrowerKarmaService(container)
    for (const item of ctx.items) {
      // Only plant line items attributed to a grower node earn grower KARMA.
      if (!item.seller_id || !item.grower_node || item.quantity <= 0) continue
      await karma.emitGrowerKarmaEvent({
        seller_id: item.seller_id,
        event_type: "units_sold",
        units: item.quantity,
        reference_id: `${data.id}:${item.line_item_id}`,
        metadata: { grower_node: item.grower_node, order_id: data.id },
      })
    }
  } catch (error) {
    log.error(`[grower-karma-on-order-placed] failed for order ${data.id}:`, error)
  }
}

export const config: SubscriberConfig = {
  event: "order.placed",
}
