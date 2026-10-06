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
import {
  consumerSubscriptionsEnabled,
  grantReadExportEntitlement,
  sweepGraceLifecycle,
} from "../workflows/subscription/grace-lifecycle"
import type { RenewalChargeRecord } from "../modules/subscription/service"
import type { SubscriptionInterval } from "../modules/subscription/types"
import { renewalPeriodStart } from "../modules/subscription/utils/renewal-charge"
import { neverRenews } from "../modules/subscription/utils/auto-renew"
import { emitSubscriptionExpired } from "../workflows/subscription/subscription-expired"

/**
 * How far a grace end is held when the final grace charge collected (or may
 * have) but a later step failed: one run of this job (schedule below is
 * hourly). Not a grace LENGTH — it only keeps the read-only sweep off a paid
 * row until the next run retries the order without charging.
 */
const GRACE_COLLECTED_HOLD_MS = 60 * 60 * 1000

/**
 * Gap E companion for the expire paths: an expired subscription must drop its
 * features.* grants so the entitlement read side agrees with the `expire`
 * webhook. Best-effort — a revocation failure must not abort the sweep.
 *
 * With FF_CONSUMER_SUBSCRIPTIONS_V1 on (F4: "read-only access with export.
 * Never quick deletion."), the revoke is followed by the same read/export
 * grant a READ_ONLY subscription gets (`grantReadExportEntitlement`, shared
 * with `enterReadOnlyForSubscription`), so an expired seat keeps export the way
 * the Black Mask contract tells the receiver to. Idempotent on a re-run or
 * redelivery (the grant reactivates its one row). A grant failure is logged
 * and never undoes the expiry, which is already written. Flag off, nothing is
 * granted and this is what it always was.
 */
async function revokeEntitlementsForExpired(
  container: MedusaContainer,
  subscription: {
    id: string
    customer_id?: string | null
    seller_id?: string | null
  }
) {
  const subscriptionId = subscription.id
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

  if (!consumerSubscriptionsEnabled()) return
  try {
    const entitlementService = container.resolve<EntitlementModuleService>(
      ENTITLEMENT_MODULE
    )
    await grantReadExportEntitlement(entitlementService, subscription)
  } catch (error) {
    log.error(
      `[Subscription Job] Failed to grant read/export to expired subscription ${subscriptionId} (the expiry stands):`,
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
 * ship dark and be cut over per environment. NOTE: that legacy path renews
 * WITHOUT charging — pre-existing behaviour, unchanged here.
 *
 * With FF_CONSUMER_SUBSCRIPTIONS_V1 on (F4), two passes follow the above:
 *   5. Live mode only: a PAST_DUE subscription (grace after exhausted
 *      dunning) gets ONE final charge when its grace ends. Success restores it
 *      to ACTIVE; a decline schedules nothing more; a charge that collected
 *      but whose renewal then failed is held, never sent to read-only.
 *   6. `sweepGraceLifecycle`: dunning-paused rows enter grace, and PAST_DUE
 *      rows whose grace has ended become READ_ONLY (read/export kept, nothing
 *      deleted).
 * With the flag on, a PAUSED subscription that never renews (no auto-renew
 * approval, or withdrawn) is also expired at its paid-period end.
 * Flag off, none of these passes runs and every path above is unchanged. An
 * until-canceled subscription (expiration_date NULL) is never expired.
 *
 * With the flag on, every expiry site also grants the read/export entitlement
 * after its revoke (`revokeEntitlementsForExpired`), as read-only does.
 *
 * Every expiry site publishes `subscription.expired` after the EXPIRED write
 * (subscription-expired.ts: only while FF_BLACK_MASK_PROVISIONING_V1 is on,
 * `occurred_at` from the row's expiration_date, failures swallowed so the
 * write stands).
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
          await revokeEntitlementsForExpired(container, subscription)
          await emitSubscriptionExpired(container, subscription)
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

    if (consumerSubscriptionsEnabled() && liveMode) {
      await processGraceFinalCharges(container, subscriptionService, trackSkip)
    }

    // Sweep for subscriptions that are still ACTIVE but past expiration.
    // (`s.expiration_date &&` skips until-canceled rows, whose date is NULL.)
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
        await revokeEntitlementsForExpired(container, s)
        await emitSubscriptionExpired(container, s)
        trackSkip(await emitSubscriptionState(container, s, "expire"))
      }
    }

    if (consumerSubscriptionsEnabled()) {
      // A PAUSED subscription bought without auto-renew approval (or whose
      // approval was withdrawn) ends at its paid-period end too. Pause keeps
      // entitlement grants, and the sweep above reads ACTIVE rows only, so
      // without this a customer who bought one period and paused on its last
      // day kept the seat until they chose to resume. Runs before the grace
      // sweep, so such a row is never moved into a grace final charge.
      const paused = await subscriptionService.listSubscriptions({
        status: SubscriptionStatus.PAUSED,
      })
      const pausedEnded = paused.filter(
        (s) => neverRenews(s) && s.expiration_date && new Date(s.expiration_date) < now
      )
      if (pausedEnded.length > 0) {
        log.info(
          `[Subscription Job] Expiring ${pausedEnded.length} paused subscription(s) past their paid period`
        )
        await subscriptionService.expireSubscription(pausedEnded.map((s) => s.id))
        for (const s of pausedEnded) {
          await revokeEntitlementsForExpired(container, s)
          await emitSubscriptionExpired(container, s)
          trackSkip(await emitSubscriptionState(container, s, "expire"))
        }
      }

      const sweep = await sweepGraceLifecycle(container)
      if (sweep.read_only.length || sweep.dunning_paused_to_grace.length || sweep.failed.length) {
        log.info(
          `[Subscription Job] grace sweep: ${sweep.dunning_paused_to_grace.length} dunning-paused → grace, ` +
            `${sweep.read_only.length} → read-only, ${sweep.failed.length} failed`
        )
      }
      for (const f of sweep.failed) {
        log.warn(`[Subscription Job] grace sweep failed for ${f.subscription_id}: ${f.error}`)
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

/**
 * F4: the one final charge a PAST_DUE subscription gets when its grace ends
 * (startGracePeriod set `next_order_date = grace_ends_at` for a payment
 * failure; a customer cancel set it NULL, so canceled rows never appear here).
 *
 * Success → `restoreFromGrace` (ACTIVE). A declined charge → no dunning loop
 * (retries were already exhausted) and nothing further is scheduled; the
 * grace sweep that follows moves the row to READ_ONLY. Past its fixed
 * expiration a row is not charged at all.
 *
 * A charge that COLLECTED is never followed by read-only: when the charge
 * step recorded the cycle `succeeded`/`processing` (or left an intent that may
 * have collected) and a later step failed, `holdGraceAfterFailure` keeps the
 * row due and holds its grace end for one run, so the next run completes the
 * order WITHOUT charging (renewal-charge.ts replays a collected cycle).
 */
async function processGraceFinalCharges(
  container: MedusaContainer,
  subscriptionService: SubscriptionModuleService,
  trackSkip: (emittedEventId: string | null) => void
): Promise<void> {
  const now = new Date()
  const due = await subscriptionService.listDueGraceRenewals(now)
  for (const subscription of due) {
    // Set once the renewal workflow has completed: the cycle is paid, the
    // order exists and the period has rolled.
    let renewed = false
    try {
      if (
        subscription.expiration_date &&
        now > new Date(subscription.expiration_date)
      ) {
        await subscriptionService.updateSubscriptions({
          selector: { id: subscription.id },
          data: { next_order_date: null },
        })
        continue
      }

      await renewSubscriptionWorkflow(container).run({
        input: { subscription_id: subscription.id },
      })
      renewed = true
      // The access-bearing write first.
      await subscriptionService.restoreFromGrace(subscription.id)
      await subscriptionService.clearDunningAttempts(subscription.id)
      trackSkip(await emitSubscriptionState(container, subscription, "renew"))
      log.info(
        `[Subscription Job] grace charge collected; ${subscription.id} restored to active`
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error"
      log.warn(
        `[Subscription Job] final grace charge failed for ${subscription.id}: ${message}`
      )
      try {
        await holdGraceAfterFailure(subscriptionService, subscription.id, now, renewed)
      } catch (writeError) {
        log.error(
          `[Subscription Job] could not record the grace-charge outcome for ${subscription.id}:`,
          writeError
        )
      }
    }
  }
}

type GraceChargeRow = {
  id: string
  status: string
  interval: SubscriptionInterval
  last_order_date: Date | string
  next_order_date?: Date | string | null
  metadata?: Record<string, unknown> | null
}

/**
 * After a failed final grace charge, decide between "nothing more is
 * scheduled" (the money did not move — the sweep then makes the row
 * READ_ONLY) and "hold" (the money moved or may have — the row must not go
 * read-only). Re-reads the row: the charge step records its outcome there.
 */
async function holdGraceAfterFailure(
  subscriptionService: SubscriptionModuleService,
  subscriptionId: string,
  now: Date,
  renewed: boolean
): Promise<void> {
  const current = (await subscriptionService.retrieveSubscription(
    subscriptionId
  )) as unknown as GraceChargeRow
  if (current.status !== SubscriptionStatus.PAST_DUE) {
    // restoreFromGrace landed; only a later bookkeeping write failed.
    return
  }

  const holdUntil = new Date(now.getTime() + GRACE_COLLECTED_HOLD_MS)

  if (renewed) {
    // Paid, ordered and rolled, but the restore write failed. Access runs
    // through the period just paid for; the next cycle's charge (at
    // next_order_date) restores the row like any grace charge.
    const paidThrough = current.next_order_date ? new Date(current.next_order_date) : null
    log.error(
      `[Subscription Job] ${subscriptionId} paid its grace charge but could not be restored to active — ` +
        `grace held through the paid period; needs operator attention`
    )
    await subscriptionService.updateSubscriptions({
      selector: { id: subscriptionId },
      data: {
        grace_ends_at:
          paidThrough && paidThrough.getTime() > holdUntil.getTime() ? paidThrough : holdUntil,
      },
    })
    return
  }

  const charge = (current.metadata?.renewal_charge ?? null) as RenewalChargeRecord | null
  const periodIso = renewalPeriodStart(current.last_order_date, current.interval).toISOString()
  const moneyMayHaveMoved =
    !!charge &&
    charge.period_start === periodIso &&
    (charge.status === "succeeded" ||
      charge.status === "processing" ||
      (charge.status === "pending" && !!charge.payment_intent_id))

  if (moneyMayHaveMoved) {
    log.error(
      `[Subscription Job] ${subscriptionId}: grace charge ${charge?.status} but the renewal did not complete — ` +
        `held for the next run, which completes it without charging again`
    )
    await subscriptionService.updateSubscriptions({
      selector: { id: subscriptionId },
      data: { next_order_date: now, grace_ends_at: holdUntil },
    })
    return
  }

  await subscriptionService.updateSubscriptions({
    selector: { id: subscriptionId },
    data: { next_order_date: null },
  })
}

export const config = {
  name: "process-subscription-renewals",
  // Run every hour
  schedule: "0 * * * *",
}
