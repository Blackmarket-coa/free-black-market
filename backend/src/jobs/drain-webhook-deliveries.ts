import { MedusaContainer } from "@medusajs/framework/types"
import { MARKETPLACE_WEBHOOKS_MODULE } from "../modules/marketplace-webhooks"
import type MarketplaceWebhooksService from "../modules/marketplace-webhooks/service"

/**
 * Scheduled Job: Drain Webhook Deliveries
 *
 * Delivers queued marketplace webhooks — both the per-seller subscriptions and
 * the global Blackout outbound channel (§1-§3). `dispatch()` / `emitBlackout()`
 * only enqueue rows; nothing ships them without this drainer. Picks up PENDING
 * deliveries and FAILED deliveries whose backoff window has elapsed.
 *
 * Registered in medusa-config.ts under the jobs array.
 */
export default async function drainWebhookDeliveriesJob(
  container: MedusaContainer
) {
  const webhooks = container.resolve<MarketplaceWebhooksService>(
    MARKETPLACE_WEBHOOKS_MODULE
  )

  try {
    const attempted = await webhooks.drainDueDeliveries(50)
    if (attempted > 0) {
      console.log(`[Webhook Drain] Attempted ${attempted} delivery(ies)`)
    }
    return { attempted }
  } catch (error) {
    console.error("[Webhook Drain] Error draining deliveries:", error)
    throw error
  }
}

export const config = {
  name: "drain-webhook-deliveries",
  // Run every minute; retry backoff is enforced per-delivery, not per-tick.
  schedule: "*/1 * * * *",
}
