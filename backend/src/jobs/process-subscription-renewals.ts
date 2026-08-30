import { createLogger } from "../shared/logger"
const log = createLogger("jobs/process-subscription-renewals")
import { MedusaContainer } from "@medusajs/framework/types"
import { SUBSCRIPTION_MODULE } from "../modules/subscription"
import SubscriptionModuleService from "../modules/subscription/service"
import { SubscriptionStatus } from "../modules/subscription/types"
import { renewSubscriptionWorkflow } from "../workflows/subscription/workflows/renew-subscription"
import { handleSubscriptionFailureWorkflow } from "../workflows/subscription/workflows/handle-subscription-failure"
import { emitSubscriptionState } from "../lib/blackout-subscription"
import { ENTITLEMENT_MODULE } from "../modules/entitlement"
import type EntitlementModuleService from "../modules/entitlement/service"

/**
 * Gap E companion for the expire paths: an expired subscription must drop its
 * features.* grants so the entitlement read side agrees with the `expire`
 * webhook. Best-effort — a revocation failure must not abort the sweep.
 */
async function revokeEntitlementsForExpired(
  container: MedusaContainer,
  subscriptionId: string
) {
  try {
    const entitlementService = container.resolve<EntitlementModuleService>(
      ENTITLEMENT_MODULE
    )
    await entitlementService.revokeBySubscriptionId(
      subscriptionId,
      "subscription_expired"
    )
  } catch (error) {
    log.error(
      `[Subscription Job] Failed to revoke entitlements for expired subscription ${subscriptionId}:`,
      error
    )
  }
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

  log.info(
    `[Subscription Job] Starting subscription renewal check (live_mode=${liveMode})...`
  )

  // Paying-but-unlinked visibility (W1b): every state emit that skipped
  // because the customer has no linked Blackout account is counted and
  // surfaced, mirroring blackout-resync's `skipped_no_blackout_account` —
  // otherwise members who pay through FBM but never linked go silently
  // unprovisioned on the Blackout side.
  let skippedNoBlackoutAccount = 0
  const trackSkip = (emittedEventId: string | null) => {
    if (emittedEventId === null) skippedNoBlackoutAccount++
  }

  try {
    const dueSubscriptions = await subscriptionService.getDueSubscriptions()

    log.info(
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
          log.info(
            `[Subscription Job] Expiring subscription ${subscription.id}`
          )
          await subscriptionService.expireSubscription(subscription.id)
          await revokeEntitlementsForExpired(container, subscription.id)
          trackSkip(await emitSubscriptionState(container, subscription, "expire"))
          continue
        }

        if (!liveMode) {
          // Legacy path — preserved for environments that haven't been
          // cut over to the workflow-driven loop yet.
          await subscriptionService.recordNewSubscriptionOrder(subscription.id)
          log.info(
            `[Subscription Job] (legacy) advanced dates for ${subscription.id}`
          )
          continue
        }

        await renewSubscriptionWorkflow(container).run({
          input: { subscription_id: subscription.id },
        })

        // Successful renewal — clear any prior dunning state.
        await subscriptionService.clearDunningAttempts(subscription.id)
        trackSkip(await emitSubscriptionState(container, subscription, "renew"))

        log.info(
          `[Subscription Job] Renewed subscription ${subscription.id}`
        )
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error"
        log.error(
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
          log.error(
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
      log.info(
        `[Subscription Job] Expiring ${expiredIds.length} past-due subscriptions`
      )
      await subscriptionService.expireSubscription(expiredIds)
      for (const s of allSubscriptions.filter((x) => expiredIds.includes(x.id))) {
        await revokeEntitlementsForExpired(container, s.id)
        trackSkip(await emitSubscriptionState(container, s, "expire"))
      }
    }

    if (skippedNoBlackoutAccount > 0) {
      log.warn(
        `[Subscription Job] skipped_no_blackout_account=${skippedNoBlackoutAccount} — paying members with no linked Blackout account were not synced`
      )
    }
    log.info("[Subscription Job] Completed subscription renewal check")
  } catch (error) {
    log.error(
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
