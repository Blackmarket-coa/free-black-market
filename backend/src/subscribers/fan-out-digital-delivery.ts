import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { MARKETPLACE_WEBHOOKS_MODULE } from "../modules/marketplace-webhooks"
import type MarketplaceWebhooksService from "../modules/marketplace-webhooks/service"
import { ENTITLEMENT_MODULE } from "../modules/entitlement"
import type EntitlementModuleService from "../modules/entitlement/service"

/**
 * Fan-out a `digital_delivery.ready` webhook on digital order creation so
 * ecosystem listeners (Blackout, vendor automations, custom integrations)
 * can react to delivery without polling. Includes any entitlements granted
 * by the same order so a single webhook unlocks downstream features.
 *
 * Best-effort: errors are logged but never crash the event bus.
 */
export default async function fanOutDigitalDelivery({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const digitalOrderId = data.id

  let webhooks: MarketplaceWebhooksService | null = null
  try {
    webhooks = container.resolve<MarketplaceWebhooksService>(MARKETPLACE_WEBHOOKS_MODULE)
  } catch {
    return
  }
  if (!webhooks) return

  let entitlements: EntitlementModuleService | null = null
  try {
    entitlements = container.resolve<EntitlementModuleService>(ENTITLEMENT_MODULE)
  } catch {
    entitlements = null
  }

  try {
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as any
    const { data: digitalOrders } = await query.graph({
      entity: "digital_product_order",
      fields: [
        "id",
        "status",
        "products.id",
        "products.name",
        "products.medias.id",
        "products.medias.fileId",
        "products.medias.type",
        "order.id",
        "order.customer_id",
        "order.metadata",
      ],
      filters: { id: digitalOrderId },
    })

    const dpo = digitalOrders?.[0]
    if (!dpo || !dpo.order) return

    const customerId = dpo.order.customer_id ?? null
    const orderId = dpo.order.id

    const grantedEntitlementIds: string[] = []
    if (entitlements && customerId) {
      try {
        const customerEnts = await entitlements.listEntitlements({
          customer_id: customerId,
          source_order_id: orderId,
        })
        for (const e of customerEnts) grantedEntitlementIds.push((e as any).id)
      } catch {
        // ignore — webhook still goes out without ent ids
      }
    }

    const payload = {
      digital_product_order_id: dpo.id,
      order_id: orderId,
      customer_id: customerId,
      products: (dpo.products || []).map((p: any) => ({
        id: p.id,
        name: p.name,
        media_ids: (p.medias || []).map((m: any) => m.id),
      })),
      entitlement_ids: grantedEntitlementIds,
    }

    // Use the order id as the recipient key so any subscriber attached to
    // the order's seller (or a wildcard) receives the event.
    await webhooks.dispatch("digital_delivery.ready", orderId, payload)
  } catch (err) {
    console.error(
      `[fan-out-digital-delivery] failed for digital_product_order ${digitalOrderId}:`,
      err
    )
  }
}

export const config: SubscriberConfig = {
  event: "digital_product_order.created",
}
