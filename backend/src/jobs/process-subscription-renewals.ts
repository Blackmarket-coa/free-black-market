import { MedusaContainer } from "@medusajs/framework/types"
import { SUBSCRIPTION_MODULE } from "../modules/subscription"
import SubscriptionModuleService from "../modules/subscription/service"
import { SubscriptionStatus } from "../modules/subscription/types"
import { renewSubscriptionWorkflow } from "../workflows/subscription/workflows/renew-subscription"
import { handleSubscriptionFailureWorkflow } from "../workflows/subscription/workflows/handle-subscription-failure"
import { emitBlackoutEvent } from "../lib/blackout-emit"
import { resolveBlackoutUserId } from "../lib/blackout-identity"
import { mapSubscriptionTier } from "../modules/marketplace-webhooks/models/blackout-events"

/**
 * Emit a §3 subscription.activated / subscription.lapsed bridge event. Resolves
 * the customer's Blackout user id; skips silently when unlinked. `epoch` keeps
 * the eventId stable per state-change without colliding across cycles.
 */
async function emitSubscriptionState(
  container: MedusaContainer,
  subscription: { id: string; customer_id?: string | null; metadata?: unknown; expiration_date?: unknown },
  state: "activated" | "lapsed"
) {
  const userId = await resolveBlackoutUserId(container, {
    customerId: subscription.customer_id ?? null,
  })
  if (!userId) return
  const tier = mapSubscriptionTier(subscription.metadata)
  await emitBlackoutEvent(
    container,
    state === "activated" ? "subscription.activated" : "subscription.lapsed",
    {
      userId,
      tier,
      subscriptionId: subscription.id,
      ...(state === "activated" && subscription.expiration_date
        ? { expiresAt: new Date(subscription.expiration_date as string).toISOString() }
        : {}),
    },
    { eventId: `subscription.${state}:${subscription.id}:${state === "lapsed" ? "expired" : "renew"}` }
  )
}

/**
 * Subscription Renewal Job
 *
 * Runs hourly. For each subscription whose `next_order_date` has elapsed:
 *   1. Skip if not ACTIVE
 *   2. Expire if past `expiration_date`
 *   3. Otherwise invoke `renewSubscriptionWorkflow`
 *   4. On workflow failure, invoke `handleSubscriptionFailureWorkflow` —
 *      records a dunning attempt, schedules a retry (1d/3d/7d), and pauses
 *      after the configured max attempts.
 *
 * Gated by `FBM_SUBSCRIPTION_RENEWAL_LIVE`. When unset, falls back to the
 * legacy date-bump path (recordNewSubscriptionOrder) so the new wiring can
 * ship dark and be cut over per environment.
 */
export default async function processSubscriptionRenewals(
  container: MedusaContainer
) {
  const subscriptionService = container.resolve<SubscriptionModuleService>(
    SUBSCRIPTION_MODULE
  )

  const liveMode = process.env.FBM_SUBSCRIPTION_RENEWAL_LIVE === "1"

  console.log(
    `[Subscription Job] Starting subscription renewal check (live_mode=${liveMode})...`
  )

  try {
    const dueSubscriptions = await subscriptionService.getDueSubscriptions()

    console.log(
      `[Subscription Job] Found ${dueSubscriptions.length} subscriptions due for renewal`
    )

    for (const subscription of dueSubscriptions) {
      try {
        if (subscription.status !== SubscriptionStatus.ACTIVE) {
          continue
        }

        if (
          subscription.expiration_date &&
          new Date() > new Date(subscription.expiration_date)
        ) {
          console.log(
            `[Subscription Job] Expiring subscription ${subscription.id}`
          )
          await subscriptionService.expireSubscription(subscription.id)
          await emitSubscriptionState(container, subscription, "lapsed")
          continue
        }

        if (!liveMode) {
          // Legacy path — preserved for environments that haven't been
          // cut over to the workflow-driven loop yet.
          await subscriptionService.recordNewSubscriptionOrder(subscription.id)
          console.log(
            `[Subscription Job] (legacy) advanced dates for ${subscription.id}`
          )
          continue
        }

        await renewSubscriptionWorkflow(container).run({
          input: { subscription_id: subscription.id },
        })

        // Successful renewal — clear any prior dunning state.
        await subscriptionService.clearDunningAttempts(subscription.id)
        await emitSubscriptionState(container, subscription, "activated")

        console.log(
          `[Subscription Job] Renewed subscription ${subscription.id}`
        )
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error"
        console.error(
          `[Subscription Job] Renewal failed for ${subscription.id}: ${message}`
        )

        if (!liveMode) {
          // Preserve historical behavior — legacy path marks failed
          // immediately with no dunning loop.
          await subscriptionService.failSubscription(subscription.id, message)
          continue
        }

        try {
          await handleSubscriptionFailureWorkflow(container).run({
            input: {
              subscription_id: subscription.id,
              error: message,
            },
          })
        } catch (dunningError) {
          console.error(
            `[Subscription Job] Dunning workflow failed for ${subscription.id}:`,
            dunningError
          )
        }
      }
    }

    // Sweep for subscriptions that are still ACTIVE but past expiration.
    const allSubscriptions = await subscriptionService.listSubscriptions({
      status: SubscriptionStatus.ACTIVE,
    })

    const now = new Date()
    const expiredIds = allSubscriptions
      .filter(
        (s) => s.expiration_date && new Date(s.expiration_date) < now
      )
      .map((s) => s.id)

    if (expiredIds.length > 0) {
      console.log(
        `[Subscription Job] Expiring ${expiredIds.length} past-due subscriptions`
      )
      await subscriptionService.expireSubscription(expiredIds)
      for (const s of allSubscriptions.filter((x) => expiredIds.includes(x.id))) {
        await emitSubscriptionState(container, s, "lapsed")
      }
    }

    console.log("[Subscription Job] Completed subscription renewal check")
  } catch (error) {
    console.error(
      "[Subscription Job] Error in subscription renewal job:",
      error
    )
  }
}

export const config = {
  name: "process-subscription-renewals",
  // Run every hour
  schedule: "0 * * * *",
}
