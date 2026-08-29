import { createLogger } from "../shared/logger"
const log = createLogger("subscribers/revoke-entitlements-on-refund")
import { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ENTITLEMENT_MODULE } from "../modules/entitlement"
import type EntitlementModuleService from "../modules/entitlement/service"
import { SUBSCRIPTION_MODULE } from "../modules/subscription"
import type SubscriptionModuleService from "../modules/subscription/service"
import { SubscriptionStatus } from "../modules/subscription/types"
import { manageSubscriptionWorkflow } from "../workflows/subscription/workflows/manage-subscription"
import subscriptionOrderLink from "../links/subscription-order"

/**
 * Sister to `process-refund-reverses-commission`: when an order is
 * canceled or refunded, revoke entitlements that were granted from it.
 * Idempotent — already-revoked entitlements are unaffected.
 *
 * W1b addition (minimal refund handling): a refunded order that belongs to a
 * subscription also cancels that subscription. Without this, the order-keyed
 * revoke misses the subscription-keyed tier bundle and the subscription
 * stays ACTIVE — the member keeps (and re-earns, next renewal) everything
 * that was just refunded. Cancel runs through manageSubscriptionWorkflow so
 * the bundle revoke (Gap E) and the Blackout lapse webhook both fire.
 */
export default async function revokeEntitlementsOnRefund({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const orderId = data.id
  const service = container.resolve<EntitlementModuleService>(ENTITLEMENT_MODULE)
  try {
    await service.revokeByOrderId(orderId, "order_refund_or_cancel")
  } catch (err) {
    log.error(`[revoke-entitlements-on-refund] failed for order ${orderId}:`, err)
  }

  try {
    const subscriptionId = await findLinkedSubscriptionId(container, orderId)
    if (!subscriptionId) return

    const subscriptionService = container.resolve<SubscriptionModuleService>(
      SUBSCRIPTION_MODULE
    )
    const subscription = await subscriptionService.retrieveSubscription(subscriptionId)
    if (
      subscription.status !== SubscriptionStatus.ACTIVE &&
      subscription.status !== SubscriptionStatus.PAUSED
    ) {
      return
    }

    await manageSubscriptionWorkflow(container).run({
      input: {
        subscription_id: subscriptionId,
        action: "cancel",
        reason: "order_refund_or_cancel",
      },
    })
    log.info(
      `[revoke-entitlements-on-refund] canceled subscription ${subscriptionId} for refunded order ${orderId}`
    )
  } catch (err) {
    log.error(
      `[revoke-entitlements-on-refund] subscription cancel failed for order ${orderId}:`,
      err
    )
  }
}

/**
 * Resolve the subscription an order belongs to: the subscription↔order link
 * (initial + renewal orders) first, then the renewal cart's metadata stamp
 * as a fallback for orders that predate the link.
 */
async function findLinkedSubscriptionId(
  container: { resolve: (key: string) => unknown },
  orderId: string
): Promise<string | null> {
  const query = container.resolve("query") as {
    graph: (q: {
      entity: string
      fields: string[]
      filters?: Record<string, unknown>
    }) => Promise<{ data?: Array<Record<string, unknown>> }>
  }

  try {
    const { data: links } = await query.graph({
      entity: subscriptionOrderLink.entryPoint,
      fields: ["subscription.id"],
      filters: { order_id: orderId },
    })
    const linked = (links?.[0]?.["subscription"] as { id?: string } | undefined)?.id
    if (typeof linked === "string" && linked) return linked
  } catch {
    // link table may not exist in minimal test envs; fall through
  }

  try {
    const { data: orders } = await query.graph({
      entity: "order",
      fields: ["id", "metadata"],
      filters: { id: orderId },
    })
    const md = (orders?.[0]?.["metadata"] ?? {}) as Record<string, unknown>
    const stamped = md["subscription_id"]
    if (typeof stamped === "string" && stamped) return stamped
  } catch {
    // no order metadata available
  }

  return null
}

export const config: SubscriberConfig = {
  event: ["order.canceled", "order.refund_created"],
}
