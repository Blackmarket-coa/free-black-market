import { createLogger } from "../shared/logger"
const log = createLogger("subscribers/emit-blackstar-order-placed")
import { SubscriberArgs, type SubscriberConfig } from "@medusajs/medusa"
import { emitBlackstarEvent } from "../lib/blackstar-emit"

/**
 * Emit Blackstar's `order.created` pre-validation hook when an order that
 * ships through the Blackstar fulfillment provider is placed.
 *
 * Gated on the order actually carrying a Blackstar shipping method — every
 * other order is none of Blackstar's business, and its inbound processor
 * treats unexpected volume as noise at best. The provider check is defensive:
 * if the shipping-option join cannot be resolved, we skip rather than spam.
 */
export default async function emitBlackstarOrderPlaced({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const orderId = data.id

  try {
    const query = container.resolve("query") as any
    const { data: orders } = await query.graph({
      entity: "order",
      fields: ["id", "shipping_methods.shipping_option_id", "shipping_methods.name"],
      filters: { id: orderId },
    })

    const order = orders?.[0]
    if (!order) return

    const methods = ((order.shipping_methods || []) as any[]).filter(Boolean)
    if (methods.length === 0) return

    const optionIds = methods
      .map((m) => m.shipping_option_id)
      .filter((v): v is string => typeof v === "string" && v.length > 0)

    let usesBlackstar = methods.some((m) =>
      String(m.name ?? "").toLowerCase().includes("blackstar")
    )

    if (!usesBlackstar && optionIds.length > 0) {
      const { data: options } = await query.graph({
        entity: "shipping_option",
        fields: ["id", "provider_id"],
        filters: { id: optionIds },
      })
      usesBlackstar = ((options || []) as any[]).some((o) =>
        String(o?.provider_id ?? "").includes("blackstar")
      )
    }

    if (!usesBlackstar) return

    await emitBlackstarEvent(
      container,
      "order.created",
      { source_order_ref: orderId },
      {
        eventId: `blackstar:order.created:${orderId}`,
        correlationId: orderId,
      }
    )
  } catch (err) {
    log.error(`[emit-blackstar-order-placed] failed for order ${orderId}:`, err)
  }
}

export const config: SubscriberConfig = {
  event: "order.placed",
}
