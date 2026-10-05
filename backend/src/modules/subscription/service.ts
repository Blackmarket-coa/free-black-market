import { MedusaService } from "@medusajs/framework/utils"
import { Subscription } from "./models"
import { 
  CreateSubscriptionData, 
  SubscriptionData, 
  SubscriptionInterval, 
  SubscriptionStatus
} from "./types"
import { AutoRenewError, SubscriptionTransitionError } from "./errors"
import { addInterval } from "./utils/interval"
import { graceEndsAt, type GraceReason } from "./utils/grace"
import {
  AUTO_RENEW_MODE_METADATA_KEY,
  AUTO_RENEW_REAPPROVAL_DISCLOSURE_VERSION,
  neverRenews,
  paidThroughOf,
} from "./utils/auto-renew"

/**
 * Where a lifecycle action may start from. Enforced here, in the service,
 * because every caller — store route, workflow step, job — funnels through
 * these methods; a guard in one route would be bypassed by the next caller.
 */
const ALLOWED_FROM = {
  // Unconditional (A3): resume revives a customer/dunning pause only. Before
  // this, resume set ACTIVE from ANY status, so a canceled, expired or failed
  // subscription could be revived by the customer.
  resume: [SubscriptionStatus.PAUSED],
  // Closes the cancel → pause → resume detour around the resume guard.
  pause: [SubscriptionStatus.ACTIVE],
  // F4 (flagged callers only).
  start_grace: [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAUSED],
  cancel_during_grace: [SubscriptionStatus.PAST_DUE],
  enter_read_only: [SubscriptionStatus.PAST_DUE],
  restore_from_grace: [SubscriptionStatus.PAST_DUE],
  // Auto-renew approval (flagged callers only). Withdrawing keeps access to
  // the end of the paid period; a paused seat may withdraw too. Approving
  // (again) is for a running seat only.
  withdraw_auto_renew: [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAUSED],
  approve_auto_renew: [SubscriptionStatus.ACTIVE],
} as const

type GuardedAction = keyof typeof ALLOWED_FROM

function assertTransition(
  subscription: { id: string; status: string },
  action: GuardedAction
): void {
  const allowed = ALLOWED_FROM[action] as ReadonlyArray<string>
  if (!allowed.includes(subscription.status)) {
    throw new SubscriptionTransitionError({
      subscription_id: subscription.id,
      from_status: subscription.status,
      action,
      allowed_from: allowed,
    })
  }
}

/**
 * `{ metadata }` with `paused_reason` removed — or `{}` when there is none, so
 * a row that never carried one gets exactly the write it always got.
 *
 * Without this, a dunning pause's `paused_reason` survived resume, and a later
 * VOLUNTARY pause of the same row read as a dunning pause to the F4 sweep
 * (grace, a final charge, read-only).
 */
function withoutPausedReason(
  metadata: unknown
): { metadata?: Record<string, unknown> } {
  const prev = (metadata as Record<string, unknown> | null) || {}
  if (!("paused_reason" in prev)) return {}
  const next = { ...prev }
  delete next.paused_reason
  return { metadata: next }
}

/**
 * The renewal charge recorded on the subscription for one cycle, BEFORE the
 * period rolls (workflows/subscription/renewal-charge.ts). Amount in the
 * currency's smallest unit (integer cents for USD).
 */
export type RenewalChargeRecord = {
  period_start: string
  idempotency_key: string
  amount: number
  currency_code: string
  status: "pending" | "succeeded" | "processing" | "failed" | "not_required"
  payment_intent_id?: string | null
  failure_reason?: string | null
  recorded_at: string
}

/**
 * Subscription Module Service
 * 
 * Manages subscription lifecycle for recurring orders including:
 * - CSA shares (weekly/monthly produce boxes)
 * - Meal plans (restaurant subscriptions)
 * - Garden memberships
 * - Cooperative memberships
 * 
 * Handles:
 * - Subscription creation with calculated dates
 * - Order date tracking
 * - Expiration and cancellation
 * - Pause/resume functionality
 */
class SubscriptionModuleService extends MedusaService({
  Subscription
}) {
  
  /**
   * Create subscriptions with calculated expiration and next order dates
   */
  // @ts-expect-error - override parent method
  async createSubscriptions(
    data: CreateSubscriptionData | CreateSubscriptionData[]
  ): Promise<SubscriptionData[]> {
    const input = Array.isArray(data) ? data : [data]

    const subscriptions = await Promise.all(
      input.map(async (subscription) => {
        const subscriptionDate = subscription.subscription_date || new Date()
        const { until_canceled, single_period, ...rest } = subscription
        // single_period (no auto-renew approval): exactly one period, stored as
        // period 1, ending at the end of the first paid period, with NO next
        // order scheduled — so the renewal job never selects it and the
        // expiry sweep ends it. Absent, every value below is what it always was.
        const period = single_period ? 1 : subscription.period
        const expirationDate = until_canceled
          ? null
          : this.getExpirationDate({
              subscription_date: subscriptionDate,
              interval: subscription.interval,
              period
            })

        return await super.createSubscriptions({
          ...rest,
          // Stamped so nothing can schedule a renewal for it later (resume,
          // the renewal job — see `neverRenews`).
          ...(single_period
            ? {
                period: 1,
                metadata: {
                  ...((rest.metadata as Record<string, unknown> | undefined) ?? {}),
                  [AUTO_RENEW_MODE_METADATA_KEY]: "single_period",
                },
              }
            : {}),
          subscription_date: subscriptionDate,
          last_order_date: subscriptionDate,
          next_order_date: single_period
            ? null
            : this.getNextOrderDate({
                last_order_date: subscriptionDate,
                expiration_date: expirationDate,
                interval: subscription.interval,
                period: subscription.period
              }),
          expiration_date: expirationDate
        })
      })
    )
    
    return subscriptions
  }

  /**
   * Record when a new subscription order is created
   * Updates last_order_date and calculates next_order_date
   */
  async recordNewSubscriptionOrder(id: string): Promise<SubscriptionData> {
    const subscription = await this.retrieveSubscription(id)
    const orderDate = new Date()

    const updated = await this.updateSubscriptions({
      selector: { id },
      data: {
        last_order_date: orderDate,
        next_order_date: this.getNextOrderDate({
          last_order_date: orderDate,
          expiration_date: subscription.expiration_date,
          interval: subscription.interval,
          period: subscription.period
        })
      }
    })

    return updated[0]
  }

  /**
   * Get subscriptions that are due for renewal
   */
  async getDueSubscriptions(): Promise<SubscriptionData[]> {
    const now = new Date()
    
    const due = await this.listSubscriptions({
      status: SubscriptionStatus.ACTIVE,
      next_order_date: { $lte: now }
    })
    // Defence in depth: a subscription bought without auto-renew approval (or
    // whose approval was withdrawn) is never due, whatever its
    // next_order_date says. Only rows written under
    // FF_CONSUMER_SUBSCRIPTIONS_V1 carry the marker; every other row passes.
    return due.filter((row) => !neverRenews(row))
  }

  /**
   * Pause a subscription
   */
  async pauseSubscription(id: string): Promise<SubscriptionData> {
    const subscription = await this.retrieveSubscription(id)
    assertTransition(subscription, "pause")
    const updated = await this.updateSubscriptions({
      selector: { id },
      data: {
        status: SubscriptionStatus.PAUSED,
        paused_at: new Date(),
        // A customer pause is not a dunning pause: drop any stale dunning
        // `paused_reason` so the F4 sweep cannot mistake it for one.
        ...withoutPausedReason(subscription.metadata)
      }
    })
    return updated[0]
  }

  /**
   * Resume a paused subscription
   */
  async resumeSubscription(id: string): Promise<SubscriptionData> {
    const subscription = await this.retrieveSubscription(id)
    assertTransition(subscription, "resume")
    const now = new Date()
    
    // Calculate new next order date from now — except for a subscription with
    // no auto-renew approval (one period, or withdrawn): it had nothing
    // scheduled before the pause and must have nothing after it. Without
    // this, pause → resume scheduled an unapproved charge whenever
    // `addInterval(now)` (setMonth overflow is not monotonic) landed before
    // its expiration_date.
    const nextOrderDate = neverRenews(subscription)
      ? null
      : this.getNextOrderDate({
          last_order_date: now,
          expiration_date: subscription.expiration_date,
          interval: subscription.interval,
          period: subscription.period
        })

    const updated = await this.updateSubscriptions({
      selector: { id },
      data: {
        status: SubscriptionStatus.ACTIVE,
        paused_at: null,
        next_order_date: nextOrderDate,
        // The pause this resume ends is over; its reason must not outlive it.
        ...withoutPausedReason(subscription.metadata)
      }
    })
    return updated[0]
  }

  /**
   * Expire subscriptions that have passed their expiration date
   */
  async expireSubscription(id: string | string[]): Promise<SubscriptionData[]> {
    const input = Array.isArray(id) ? id : [id]

    return await this.updateSubscriptions({
      selector: { id: input },
      data: {
        next_order_date: null,
        status: SubscriptionStatus.EXPIRED
      }
    })
  }

  /**
   * Cancel subscriptions
   */
  async cancelSubscriptions(id: string | string[]): Promise<SubscriptionData[]> {
    const input = Array.isArray(id) ? id : [id]

    return await this.updateSubscriptions({
      selector: { id: input },
      data: {
        next_order_date: null,
        status: SubscriptionStatus.CANCELED,
        canceled_at: new Date()
      }
    })
  }

  /**
   * Mark subscription as failed (e.g., payment failure)
   */
  async failSubscription(id: string, reason?: string): Promise<SubscriptionData> {
    // MERGE, never replace (A4): the old `metadata: { failure_reason }` wiped
    // initial_order_id, creator_listing_id, blackout_tier and the dunning
    // counters off the row.
    const subscription = await this.retrieveSubscription(id)
    const prevMetadata = (subscription.metadata as Record<string, unknown>) || {}
    const updated = await this.updateSubscriptions({
      selector: { id },
      data: {
        status: SubscriptionStatus.FAILED,
        metadata: { ...prevMetadata, failure_reason: reason }
      }
    })
    return updated[0]
  }

  // ===========================================================================
  // F4 lifecycle — grace, then read-only, never deletion.
  // Called only from FF_CONSUMER_SUBSCRIPTIONS_V1-gated callers
  // (workflows/subscription/grace-lifecycle.ts). The grace LENGTH is always an
  // argument: this module cannot read product metadata, and must never pick a
  // number itself.
  // ===========================================================================

  /**
   * ACTIVE/PAUSED → PAST_DUE. Snapshots `grace_period_days` on the row.
   *
   * - `payment_failed`: the next renewal attempt is set to the end of grace —
   *   one final charge before read-only, which, if it succeeds, restores the
   *   subscription (`restoreFromGrace`).
   * - `customer_canceled`: `canceled_at` is stamped and no further renewal is
   *   scheduled; access continues until `grace_ends_at`.
   *
   * Entitlements are not touched here; nothing is revoked on entering grace.
   */
  async startGracePeriod(
    id: string,
    args: {
      reason: GraceReason
      grace_period_days: number
      starts_at: Date
      now?: Date
    }
  ): Promise<SubscriptionData> {
    const subscription = await this.retrieveSubscription(id)
    assertTransition(subscription, "start_grace")
    const now = args.now ?? new Date()
    const endsAt = graceEndsAt(args.starts_at, args.grace_period_days)
    const prevMetadata = (subscription.metadata as Record<string, unknown>) || {}

    const updated = await this.updateSubscriptions({
      selector: { id },
      data: {
        status: SubscriptionStatus.PAST_DUE,
        grace_ends_at: endsAt,
        grace_period_days: args.grace_period_days,
        next_order_date: args.reason === "payment_failed" ? endsAt : null,
        ...(args.reason === "customer_canceled" ? { canceled_at: now } : {}),
        metadata: {
          ...prevMetadata,
          grace_reason: args.reason,
          grace_started_at: now.toISOString(),
          grace_from_status: subscription.status,
        },
      },
    })
    return updated[0]
  }

  /**
   * A customer cancels while already in grace (PAST_DUE after a failed
   * payment): stamp `canceled_at` and drop the final renewal attempt. Status
   * and `grace_ends_at` are unchanged — canceling never shortens grace.
   */
  async cancelDuringGrace(id: string, now: Date = new Date()): Promise<SubscriptionData> {
    const subscription = await this.retrieveSubscription(id)
    assertTransition(subscription, "cancel_during_grace")
    const updated = await this.updateSubscriptions({
      selector: { id },
      data: { canceled_at: now, next_order_date: null },
    })
    return updated[0]
  }

  /**
   * PAST_DUE whose grace has ended → READ_ONLY. Refuses while grace is still
   * running. Nothing is deleted; the row, its orders and its history stay.
   */
  async enterReadOnly(id: string, now: Date = new Date()): Promise<SubscriptionData> {
    const subscription = await this.retrieveSubscription(id)
    assertTransition(subscription, "enter_read_only")
    const ends = subscription.grace_ends_at
      ? new Date(subscription.grace_ends_at).getTime()
      : NaN
    if (Number.isNaN(ends) || ends > now.getTime()) {
      throw new SubscriptionTransitionError({
        subscription_id: id,
        from_status: subscription.status,
        action: "enter_read_only (grace still running)",
        allowed_from: [SubscriptionStatus.PAST_DUE],
      })
    }
    const updated = await this.updateSubscriptions({
      selector: { id },
      data: {
        status: SubscriptionStatus.READ_ONLY,
        read_only_at: now,
        next_order_date: null,
      },
    })
    return updated[0]
  }

  /**
   * A charge succeeded during grace: PAST_DUE → ACTIVE, grace fields cleared.
   * Dates were already rolled by the renewal that collected.
   */
  async restoreFromGrace(id: string): Promise<SubscriptionData> {
    const subscription = await this.retrieveSubscription(id)
    assertTransition(subscription, "restore_from_grace")
    const prevMetadata = (subscription.metadata as Record<string, unknown>) || {}
    const metadata = { ...prevMetadata }
    delete metadata.grace_reason
    delete metadata.grace_started_at
    delete metadata.grace_from_status
    delete metadata.paused_reason
    const updated = await this.updateSubscriptions({
      selector: { id },
      data: {
        status: SubscriptionStatus.ACTIVE,
        grace_ends_at: null,
        grace_period_days: null,
        paused_at: null,
        metadata,
      },
    })
    return updated[0]
  }

  // ===========================================================================
  // Affirmative auto-renew approval (FF_CONSUMER_SUBSCRIPTIONS_V1 callers only:
  // POST /store/subscriptions/:id). Guarded here, in the service, like every
  // other lifecycle write. Whether the product may be sold until cancelled is
  // an argument — this module cannot read product metadata.
  // ===========================================================================

  /**
   * The customer withdraws auto-renew approval. The seat stays as it is
   * until the end of the period already paid for, then ends: `expiration_date`
   * becomes that period end (never earlier than now) and no next order is
   * scheduled, so the renewal job never charges again and the expiry sweep
   * ends it on time.
   *
   * Only an until-cancelled subscription (expiration NULL) has an automatic
   * renewal to withdraw; a fixed-term one is refused with
   * `auto_renew_not_on`.
   */
  async withdrawAutoRenew(id: string, now: Date = new Date()): Promise<SubscriptionData> {
    const subscription = await this.retrieveSubscription(id)
    assertTransition(subscription, "withdraw_auto_renew")
    if (subscription.expiration_date !== null && subscription.expiration_date !== undefined) {
      throw new AutoRenewError(
        "auto_renew_not_on",
        id,
        `Subscription ${id} does not renew automatically; there is nothing to withdraw.`
      )
    }
    const paidThrough = paidThroughOf(subscription)
    const endsAt = paidThrough.getTime() > now.getTime() ? paidThrough : new Date(now)
    const prevMetadata = (subscription.metadata as Record<string, unknown>) || {}

    const updated = await this.updateSubscriptions({
      selector: { id },
      data: {
        auto_renew_approved: false,
        expiration_date: endsAt,
        next_order_date: null,
        metadata: {
          ...prevMetadata,
          auto_renew_withdrawn_at: now.toISOString(),
          [AUTO_RENEW_MODE_METADATA_KEY]: "withdrawn",
        },
      },
    })
    return updated[0]
  }

  /**
   * The customer approves auto-renewal again (after withdrawing, or after
   * buying a single period). Requires, all refused with a specific code:
   *
   *   - the CURRENT re-approval disclosure version — an approval of stale
   *     copy, or of the purchase-time wording (which promises a charge
   *     "today"), is not an approval of what renews
   *     (`auto_renew_disclosure_outdated`);
   *   - a product that may be sold until cancelled (`auto_renew_not_offered`);
   *   - a card saved for off-session renewals (`auto_renew_payment_method_required`)
   *     — none is saved when the customer did not approve at purchase, and a
   *     renewal promised against no card could only fail;
   *   - a seat with nothing scheduled whose paid period has not yet ended
   *     (`auto_renew_not_available`).
   *
   * On success: approved, stamped with the time and version, until cancelled
   * (`expiration_date` NULL), next order at the end of the paid period.
   */
  async approveAutoRenew(
    id: string,
    args: { disclosure_version: string; product_allows_until_canceled: boolean; now?: Date }
  ): Promise<SubscriptionData> {
    const subscription = await this.retrieveSubscription(id)
    assertTransition(subscription, "approve_auto_renew")
    const now = args.now ?? new Date()

    if (args.disclosure_version !== AUTO_RENEW_REAPPROVAL_DISCLOSURE_VERSION) {
      throw new AutoRenewError(
        "auto_renew_disclosure_outdated",
        id,
        `The auto-renewal terms have changed (current version ${AUTO_RENEW_REAPPROVAL_DISCLOSURE_VERSION}). ` +
          `Review the current terms and approve again.`
      )
    }
    if (!args.product_allows_until_canceled) {
      throw new AutoRenewError(
        "auto_renew_not_offered",
        id,
        `Automatic renewal is not offered for subscription ${id}'s product.`
      )
    }
    const endsAt = subscription.expiration_date ? new Date(subscription.expiration_date) : null
    if (subscription.next_order_date || !endsAt || endsAt.getTime() <= now.getTime()) {
      throw new AutoRenewError(
        "auto_renew_not_available",
        id,
        `Subscription ${id} cannot switch automatic renewal on: it is already renewing or its paid period has ended.`
      )
    }
    if (!subscription.payment_method_id) {
      throw new AutoRenewError(
        "auto_renew_payment_method_required",
        id,
        `Subscription ${id} has no card saved for renewals.`
      )
    }

    const updated = await this.updateSubscriptions({
      selector: { id },
      data: {
        auto_renew_approved: true,
        auto_renew_approved_at: now,
        auto_renew_disclosure_version: args.disclosure_version,
        expiration_date: null,
        next_order_date: endsAt,
        metadata: {
          ...((subscription.metadata as Record<string, unknown> | null) || {}),
          [AUTO_RENEW_MODE_METADATA_KEY]: "until_canceled",
        },
      },
    })
    return updated[0]
  }

  /** PAST_DUE rows whose grace has ended. */
  async listGraceExpired(now: Date = new Date()): Promise<SubscriptionData[]> {
    return this.listSubscriptions({
      status: SubscriptionStatus.PAST_DUE,
      grace_ends_at: { $lte: now },
    })
  }

  /** PAST_DUE rows with a final renewal attempt due (payment_failed grace). */
  async listDueGraceRenewals(now: Date = new Date()): Promise<SubscriptionData[]> {
    return this.listSubscriptions({
      status: SubscriptionStatus.PAST_DUE,
      next_order_date: { $lte: now },
    })
  }

  /**
   * Record (or update) this cycle's renewal charge on the subscription.
   * Merged into metadata; nothing else on the row changes.
   */
  async recordRenewalCharge(
    id: string,
    charge: RenewalChargeRecord
  ): Promise<SubscriptionData> {
    const subscription = await this.retrieveSubscription(id)
    const prevMetadata = (subscription.metadata as Record<string, unknown>) || {}
    const updated = await this.updateSubscriptions({
      selector: { id },
      data: { metadata: { ...prevMetadata, renewal_charge: charge } },
    })
    return updated[0]
  }

  /**
   * Record a dunning attempt against a subscription. Returns the updated
   * subscription with `metadata.dunning_attempts` incremented and
   * `metadata.dunning_last_error` set. Caller decides whether to schedule
   * a retry or pause.
   */
  async recordDunningAttempt(
    id: string,
    error?: string
  ): Promise<SubscriptionData> {
    const subscription = await this.retrieveSubscription(id)
    const prevMetadata = (subscription.metadata as Record<string, unknown>) || {}
    const prevAttempts = Number(prevMetadata.dunning_attempts ?? 0)
    const attempts = prevAttempts + 1

    const updated = await this.updateSubscriptions({
      selector: { id },
      data: {
        metadata: {
          ...prevMetadata,
          dunning_attempts: attempts,
          dunning_last_attempt_at: new Date().toISOString(),
          dunning_last_error: error ?? null,
        },
      },
    })
    return updated[0]
  }

  /**
   * Pause a subscription with a reason recorded on metadata. Used by the
   * dunning workflow when retries are exhausted.
   */
  async pauseSubscriptionWithReason(
    id: string,
    reason: string
  ): Promise<SubscriptionData> {
    const subscription = await this.retrieveSubscription(id)
    const prevMetadata = (subscription.metadata as Record<string, unknown>) || {}

    const updated = await this.updateSubscriptions({
      selector: { id },
      data: {
        status: SubscriptionStatus.PAUSED,
        paused_at: new Date(),
        metadata: {
          ...prevMetadata,
          paused_reason: reason,
        },
      },
    })
    return updated[0]
  }

  /**
   * Reset dunning state, e.g. after a successful renewal payment.
   */
  async clearDunningAttempts(id: string): Promise<SubscriptionData> {
    const subscription = await this.retrieveSubscription(id)
    const prevMetadata = (subscription.metadata as Record<string, unknown>) || {}
    if (!prevMetadata.dunning_attempts) {
      return subscription
    }

    const cleared = { ...prevMetadata }
    delete cleared.dunning_attempts
    delete cleared.dunning_last_attempt_at
    delete cleared.dunning_last_error

    const updated = await this.updateSubscriptions({
      selector: { id },
      data: { metadata: cleared },
    })
    return updated[0]
  }

  /**
   * Calculate the next order date based on interval
   */
  getNextOrderDate({
    last_order_date,
    expiration_date,
    interval,
  }: {
    last_order_date: Date
    expiration_date: Date | null
    interval: SubscriptionInterval
    period: number
  }): Date | null {
    const nextDate = addInterval(last_order_date, interval)

    // Until-canceled (expiration_date NULL): no horizon. Without this,
    // `new Date(null)` is the epoch and every next date would read as
    // "past expiration", so an until-canceled subscription would never renew.
    if (expiration_date === null || expiration_date === undefined) {
      return nextDate
    }

    // If next order date is after expiration, return null
    if (nextDate > new Date(expiration_date)) {
      return null
    }

    return nextDate
  }

  /**
   * Calculate expiration date based on subscription start and interval
   */
  getExpirationDate({
    subscription_date,
    interval,
    period
  }: {
    subscription_date: Date
    interval: SubscriptionInterval
    period: number
  }): Date {
    const startDate = new Date(subscription_date)
    let expirationDate: Date

    switch (interval) {
      case SubscriptionInterval.WEEKLY:
        expirationDate = new Date(startDate.getTime() + period * 7 * 24 * 60 * 60 * 1000)
        break
      case SubscriptionInterval.BIWEEKLY:
        expirationDate = new Date(startDate.getTime() + period * 14 * 24 * 60 * 60 * 1000)
        break
      case SubscriptionInterval.MONTHLY:
        expirationDate = new Date(startDate)
        expirationDate.setMonth(expirationDate.getMonth() + period)
        break
      case SubscriptionInterval.QUARTERLY:
        expirationDate = new Date(startDate)
        expirationDate.setMonth(expirationDate.getMonth() + (period * 3))
        break
      case SubscriptionInterval.YEARLY:
        expirationDate = new Date(startDate)
        expirationDate.setFullYear(expirationDate.getFullYear() + period)
        break
      default:
        expirationDate = new Date(startDate)
        expirationDate.setMonth(expirationDate.getMonth() + period)
    }

    return expirationDate
  }

  /**
   * Get subscriptions for a customer
   */
  async getCustomerSubscriptions(customerId: string): Promise<SubscriptionData[]> {
    return this.listSubscriptions({ customer_id: customerId })
  }

  /**
   * Get subscriptions for a seller/vendor
   */
  async getSellerSubscriptions(sellerId: string): Promise<SubscriptionData[]> {
    return this.listSubscriptions({ seller_id: sellerId })
  }

  /**
   * Get active subscriptions count for a product
   */
  async getProductSubscriptionCount(productId: string): Promise<number> {
    const subscriptions = await this.listSubscriptions({
      product_id: productId,
      status: SubscriptionStatus.ACTIVE
    })
    return subscriptions.length
  }
}

export default SubscriptionModuleService
