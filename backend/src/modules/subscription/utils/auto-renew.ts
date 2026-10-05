import { SubscriptionInterval } from "../types"
import { addInterval } from "./interval"

/**
 * Affirmative auto-renew approval (Black Mask F2; operator answer 2026-10-05:
 * seats "renew upon approval").
 *
 * A subscription renews until cancelled ONLY when the customer affirmatively
 * approved automatic renewal at purchase, against a product that may be sold
 * that way (product metadata `subscription_until_canceled`, see
 * `utils/grace.ts`). Without that approval it is bought for exactly one
 * period and never renews. Both rules apply only under
 * FF_CONSUMER_SUBSCRIPTIONS_V1; flag off, nothing here is reached.
 *
 * Pure: no container, so the decisions are unit-testable on their own.
 */

/**
 * The version of the auto-renewal disclosure the storefront shows next to the
 * approval checkbox (storefront/src/lib/subscriptions/auto-renew.ts carries
 * the same constant and the text itself). The approval is stored with the
 * version the customer saw; an approval for any other version is refused, so a
 * changed disclosure can never be silently "approved" with stale copy.
 *
 * Changing the disclosure text means bumping this value on BOTH sides.
 */
export const AUTO_RENEW_DISCLOSURE_VERSION = "2026-10-05"

/** What the customer said at purchase, as recorded by POST /store/subscriptions. */
export type AutoRenewApproval = {
  approved: boolean
  /** The disclosure version shown; null when the customer did not approve. */
  disclosure_version: string | null
  /** ISO timestamp of the approval (the purchase request). */
  approved_at: string
}

export type CreateTerms =
  | { mode: "until_canceled" }
  | { mode: "single_period" }

/**
 * How a new subscription is created once the customer has answered the
 * auto-renew question:
 *
 *   - approved AND the product may be sold until cancelled → until cancelled
 *     (`expiration_date` NULL, renewals scheduled);
 *   - anything else → exactly one period, nothing scheduled, never renews.
 */
export function decideCreateTerms(args: {
  approved: boolean
  product_allows_until_canceled: boolean
}): CreateTerms {
  return args.approved && args.product_allows_until_canceled
    ? { mode: "until_canceled" }
    : { mode: "single_period" }
}

/**
 * The end of the period the customer has already paid for: one interval after
 * the last order. Read from `last_order_date`, which moves only when a cycle
 * actually rolls — never from `next_order_date`, which the dunning loop
 * rewrites to each retry date.
 */
export function paidThroughOf(row: {
  last_order_date: Date | string
  interval: SubscriptionInterval
}): Date {
  return addInterval(row.last_order_date, row.interval)
}

/**
 * The version of the RE-APPROVAL disclosure (account page → turn automatic
 * renewal back on). Its wording differs from the purchase disclosure — nothing
 * is charged at re-approval, and the card already saved for the subscription
 * is the one charged at the paid-period end — so it carries its own version,
 * and `approveAutoRenew` accepts only this one. Changing that text means
 * bumping this value on BOTH sides (storefront/src/lib/subscriptions/auto-renew.ts).
 */
export const AUTO_RENEW_REAPPROVAL_DISCLOSURE_VERSION = "2026-10-05.reapproval"

/**
 * `metadata.auto_renew_mode`, stamped by the service when a subscription is
 * created for a single period (no approval) and when an approval is
 * withdrawn; overwritten with `until_canceled` on re-approval. Only rows
 * created or changed under FF_CONSUMER_SUBSCRIPTIONS_V1 ever carry it, so a
 * legacy row is never read as one.
 */
export const AUTO_RENEW_MODE_METADATA_KEY = "auto_renew_mode"
export type AutoRenewMode = "until_canceled" | "single_period" | "withdrawn"

/**
 * True for a subscription that must never renew: bought for one period with
 * no approval, or whose approval was withdrawn — and not approved since.
 * Nothing may schedule a next order for it (resume, the renewal job): with no
 * approval there is nothing to charge it for.
 */
export function neverRenews(row: {
  auto_renew_approved?: boolean | null
  metadata?: unknown
}): boolean {
  if (row.auto_renew_approved === true) return false
  const mode = (row.metadata as Record<string, unknown> | null | undefined)?.[
    AUTO_RENEW_MODE_METADATA_KEY
  ]
  return mode === "single_period" || mode === "withdrawn"
}
