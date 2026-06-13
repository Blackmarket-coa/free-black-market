import { createLogger } from "../shared/logger"
const log = createLogger("subscribers/revoke-entitlements-on-refund")
import { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ENTITLEMENT_MODULE } from "../modules/entitlement"
import type EntitlementModuleService from "../modules/entitlement/service"

/**
 * Sister to `process-refund-reverses-commission`: when an order is
 * canceled or refunded, revoke entitlements that were granted from it.
 * Idempotent — already-revoked entitlements are unaffected.
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
}

export const config: SubscriberConfig = {
  event: ["order.canceled", "order.refund_created"],
}
