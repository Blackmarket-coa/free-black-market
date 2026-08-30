import { createLogger } from "../shared/logger"
const log = createLogger("subscribers/grant-entitlements-on-order-placed")
import { SubscriberArgs, type SubscriberConfig } from "@medusajs/medusa"
import { ENTITLEMENT_MODULE } from "../modules/entitlement"
import type EntitlementModuleService from "../modules/entitlement/service"
import { resolveCustomerMxid } from "../lib/blackout-identity"

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
    // `customer_external_id` is documented as the Matrix mxid (Ambiguity B).
    // Source it from the order's mxid stamp or the customer's stored mxid —
    // never from `fbm_external_customer_id`, which carries the Blackout OAuth
    // sub and previously leaked into this column.
    let externalId = typeof md.mxid === "string" && md.mxid ? md.mxid : null
    if (!externalId && order.customer_id) {
      externalId = await resolveCustomerMxid(container, order.customer_id)
    }
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
