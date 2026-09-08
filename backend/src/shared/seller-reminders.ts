import { createLogger } from "./logger"
import { daysUntil, isExpired, asExpiryDate } from "./expiry"
import { featureFlagState } from "./feature-flags"

const log = createLogger("shared/seller-reminders")

/**
 * The shared reminder rail.
 *
 * Two things in this codebase knew something was wrong and could tell nobody.
 * `jobs/ar-dunning-sweep.ts` emits `ar.invoice.overdue` at five ladder stages
 * and had no subscriber anywhere in the repo. `GET /admin/vault` can list
 * documents lapsing inside a window and there was no vendor-facing counterpart
 * at all. Both needed the same thing — a way to reach one seller — so it is
 * built once, here, and both use it.
 *
 * Delivery is the vendor notification drawer (`channel: "seller_feed"`, read by
 * `GET /vendor/notifications/buckets`). This is that channel's first producer.
 * Email is deliberately not attempted: `modules/resend` accepts a closed list
 * of eight templates and, for anything outside it, `send()` logs and returns
 * `{}` — it drops the message silently rather than refusing it. Adding a
 * reminder email means adding a real template to that list, which is its own
 * change; sending one now would produce exactly the "reminder nobody could
 * receive" defect this rail exists to end.
 */

/**
 * Templates this rail produces.
 *
 * These strings are also registered in `lib/notification-buckets.ts` as
 * `awaits_me`. That is not cosmetic: the drawer's badge counts `awaits_me`
 * only, and the classifier is template-driven with a default of `about_me`.
 * An unregistered reminder template would be delivered correctly and still
 * never raise the badge the vendor actually looks at.
 */
export const SELLER_REMINDER_TEMPLATES = {
  DOCUMENT_EXPIRING: "seller_document_expiring_action_required",
  DOCUMENT_EXPIRED: "seller_document_expired_action_required",
  INVOICE_OVERDUE: "seller_invoice_overdue_action_required",
} as const

export type SellerReminderTemplate =
  (typeof SELLER_REMINDER_TEMPLATES)[keyof typeof SELLER_REMINDER_TEMPLATES]

/**
 * Days-before-expiry at which a document reminder is raised.
 *
 * Mirrors the AR dunning ladder's shape (1, 7, 14, 30, 60 days *past* due) and
 * runs the other way: 30, 14, 7 and 1 days *before*, then once on the day it
 * lapses. Descending so `expiryReminderStage` can return the first match.
 */
export const EXPIRY_REMINDER_DAYS: readonly number[] = [30, 14, 7, 1, 0] as const

/**
 * Which rung, if any, a document sits on today.
 *
 * Fires only on the exact day a rung is reached — the same rule that makes
 * `ar-dunning-sweep` idempotent across a same-day re-run. A document 12 days
 * out is on no rung and is not mentioned; two days later it is.
 *
 * Negative days (already lapsed) return `null` here. An expired document is
 * not "expiring in -3 days"; it is a different message, and the sweep sends it
 * once via `DOCUMENT_EXPIRED` rather than re-chasing it down an endless ladder.
 */
export function expiryReminderStage(days: number): number | null {
  return EXPIRY_REMINDER_DAYS.find((rung) => rung === days) ?? null
}

export type SellerReminder = {
  /** The seller the drawer belongs to. Feed rows are addressed by seller id. */
  seller_id: string
  template: SellerReminderTemplate
  /**
   * Identifies the thing being chased, so a re-run can tell that this exact
   * reminder has already gone out. Written into `data` and read back by the
   * producers rather than stored in a new column — the notification row is
   * the record of having told someone, and a separate marker could drift
   * from it.
   */
  subject_id: string
  /** Which rung this reminder is; part of the dedupe identity. */
  stage: number
  data: Record<string, unknown>
}

/** `subject_id` + `stage`, the identity a reminder is deduped on. */
export function reminderKey(subjectId: string, stage: number): string {
  return `${subjectId}:${stage}`
}

export type ReminderDeliveryResult = {
  considered: number
  delivered: number
  skipped: number
  failed: number
  live: boolean
}

/**
 * Is the rail allowed to actually deliver?
 *
 * Default off, following `FBM_AR_DUNNING_LIVE`'s reasoning: a reminder rail
 * that half-works is worse than one that is plainly off, because the ladder
 * advances and the vendor is recorded as told. Uses the repo's flag registry
 * rather than a second bare `process.env` read.
 */
export function remindersAreLive(): boolean {
  return featureFlagState.isEnabled("SELLER_REMINDERS_V1")
}

type NotificationModuleLike = {
  createNotifications: (payload: Record<string, unknown>) => Promise<unknown>
}

/**
 * Deliver a batch of reminders, or report what would have been sent.
 *
 * Never throws. A reminder that cannot be delivered must not take down the job
 * or subscriber that raised it — the `shared/booking-notify` rule — and one bad
 * row must not abort the batch, the `ar-dunning-sweep` rule.
 *
 * When the flag is off this reports at `warn` and sends nothing, so an operator
 * can see the rail is loaded and what it would say before switching it on.
 */
export async function deliverSellerReminders(
  container: { resolve: (key: string) => unknown },
  reminders: readonly SellerReminder[]
): Promise<ReminderDeliveryResult> {
  const result: ReminderDeliveryResult = {
    considered: reminders.length,
    delivered: 0,
    skipped: 0,
    failed: 0,
    live: remindersAreLive(),
  }

  if (reminders.length === 0) return result

  if (!result.live) {
    result.skipped = reminders.length
    log.warn(
      `DRY RUN: ${reminders.length} seller reminder(s) would be delivered but ` +
        `FF_SELLER_REMINDERS_V1 is not "true". Nothing has been sent and no ` +
        `reminder is recorded, so every one of these remains sendable once the ` +
        `flag is on.`
    )
    return result
  }

  let notification: NotificationModuleLike | null = null
  try {
    notification = container.resolve("notification") as NotificationModuleLike
  } catch {
    notification = null
  }

  if (!notification) {
    result.skipped = reminders.length
    log.warn(
      `${reminders.length} seller reminder(s) not delivered: no notification ` +
        `module is registered.`
    )
    return result
  }

  for (const reminder of reminders) {
    try {
      await notification.createNotifications({
        to: reminder.seller_id,
        channel: "seller_feed",
        template: reminder.template,
        data: {
          ...reminder.data,
          subject_id: reminder.subject_id,
          stage: reminder.stage,
        },
      })
      result.delivered += 1
    } catch (err) {
      result.failed += 1
      log.error(
        `[seller-reminders] failed to deliver ${reminder.template} for ` +
          `${reminder.subject_id} to ${reminder.seller_id}`,
        err
      )
    }
  }

  return result
}

/**
 * Build the reminder for one document-like row, or `null` if today is not a day
 * it should be mentioned.
 *
 * Shared by the vault sweep and available to any other expiry producer, so the
 * "is it time to say something" decision exists once rather than per caller.
 */
export function buildExpiryReminder(input: {
  seller_id: string
  subject_id: string
  expires_at: Date | string | null | undefined
  now: Date
  data?: Record<string, unknown>
}): SellerReminder | null {
  const expires = asExpiryDate(input.expires_at)
  if (!expires) return null

  const days = daysUntil(expires, input.now)

  if (isExpired(expires, input.now)) {
    // One message on the first sweep after it lapses, not a ladder. `-1` is
    // the stage so it cannot collide with the `0` rung sent earlier that day.
    if (days !== -1) return null
    return {
      seller_id: input.seller_id,
      template: SELLER_REMINDER_TEMPLATES.DOCUMENT_EXPIRED,
      subject_id: input.subject_id,
      stage: -1,
      data: { ...(input.data ?? {}), expires_at: expires.toISOString(), days_until: days },
    }
  }

  const stage = expiryReminderStage(days)
  if (stage === null) return null

  return {
    seller_id: input.seller_id,
    template: SELLER_REMINDER_TEMPLATES.DOCUMENT_EXPIRING,
    subject_id: input.subject_id,
    stage,
    data: { ...(input.data ?? {}), expires_at: expires.toISOString(), days_until: days },
  }
}
