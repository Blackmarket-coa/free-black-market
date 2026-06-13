import { createLogger } from "../shared/logger"
const log = createLogger("subscribers/grant-entitlements-on-order-placed")
import { SubscriberArgs, type SubscriberConfig } from "@medusajs/medusa"
import { ENTITLEMENT_MODULE } from "../modules/entitlement"
import type EntitlementModuleService from "../modules/entitlement/service"

/**
 * Grant entitlements declared by EntitlementGrantRule for each line item in
 * a freshly-placed order. Idempotent — duplicate `order.placed` events do
 * not create duplicate entitlements (the (source_order_id, product_id)
 * unique index enforces this).
 */
export default async function grantEntitlementsOnOrderPlaced({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const orderId = data.id
  const entitlementService = container.resolve<EntitlementModuleService>(
    ENTITLEMENT_MODULE
  )

  try {
    const query = container.resolve("query") as any
    const { data: orders } = await query.graph({
      entity: "order",
      fields: [
        "id",
        "customer_id",
        "metadata",
        "items.id",
        "items.product_id",
        "items.variant_id",
      ],
      filters: { id: orderId },
    })

    const order = orders?.[0]
    if (!order) return

    const items = (order.items || []).map((it: any) => ({
      product_id: it.product_id ?? null,
      variant_id: it.variant_id ?? null,
    }))

    const md = (order.metadata || {}) as Record<string, unknown>
    const externalId =
      typeof md.fbm_external_customer_id === "string"
        ? (md.fbm_external_customer_id as string)
        : null
    const sourceSubscriptionId =
      typeof md.subscription_id === "string"
        ? (md.subscription_id as string)
        : null

    await entitlementService.grantFromOrder({
      order_id: orderId,
      customer_id: order.customer_id ?? null,
      customer_external_id: externalId,
      items,
      source_subscription_id: sourceSubscriptionId,
    })
  } catch (err) {
    log.error(`[grant-entitlements-on-order-placed] failed for order ${orderId}:`, err)
  }
}

export const config: SubscriberConfig = {
  event: "order.placed",
}
