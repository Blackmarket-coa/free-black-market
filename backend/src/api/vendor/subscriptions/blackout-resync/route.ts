import { createLogger } from "../../../../shared/logger"
const log = createLogger("api/vendor/subscriptions/blackout-resync")
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { requireSellerId } from "../../../../shared/auth-helpers"
import { SUBSCRIPTION_MODULE } from "../../../../modules/subscription"
import type SubscriptionModuleService from "../../../../modules/subscription/service"
import { SubscriptionStatus } from "../../../../modules/subscription/types"
import { emitSubscriptionState } from "../../../../lib/blackout-subscription"

/**
 * POST /vendor/subscriptions/blackout-resync
 *
 * "Force sync all members" for the authenticated seller's Blackout Space.
 *
 * Re-emits `subscription.activated` for every ACTIVE membership the seller has,
 * so Blackout can reconcile room ACLs after a drift or an outage. This reuses
 * the same fire-and-forget outbound channel as the real-time lifecycle hooks —
 * each event is signed, deduped (stable eventId) and retried by the webhook
 * drain job. Members who have not linked a Blackout account are skipped.
 *
 * It is intentionally cheap and non-blocking: it only enqueues, it does not wait
 * for delivery. `queued` reflects how many events were enqueued this call;
 * `estimated_seconds` is a rough drain-time hint for the UI progress affordance.
 */
export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const sellerId = await requireSellerId(req, res)
  if (!sellerId) return

  const subscriptionService = req.scope.resolve<SubscriptionModuleService>(
    SUBSCRIPTION_MODULE
  )

  const active = await subscriptionService.listSubscriptions({
    seller_id: sellerId,
    status: SubscriptionStatus.ACTIVE,
  })

  let queued = 0
  for (const sub of active) {
    try {
      const eventId = await emitSubscriptionState(req.scope, sub, "subscribe")
      if (eventId) queued++
    } catch (err) {
      // emitSubscriptionState already swallows; this is belt-and-suspenders so
      // one bad row never aborts the sweep.
      log.warn(
        `[blackout-resync] failed to enqueue for subscription ${sub.id}: ${
          err instanceof Error ? err.message : err
        }`
      )
    }
  }

  // Drain job processes up to 25 deliveries/minute by default.
  const estimatedSeconds = queued === 0 ? 0 : Math.max(5, Math.ceil(queued / 25) * 60)

  log.info(
    `[blackout-resync] seller=${sellerId} active=${active.length} queued=${queued}`
  )

  return res.json({
    queued,
    total_active: active.length,
    skipped_no_blackout_account: active.length - queued,
    estimated_seconds: estimatedSeconds,
  })
}
