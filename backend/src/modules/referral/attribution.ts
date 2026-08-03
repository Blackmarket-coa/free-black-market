/**
 * Generic seller referral — the pure state around "who referred this seller
 * onto the platform, and are they still owed a cut".
 *
 * Distinct from the creator program's affiliate attribution
 * (`modules/creator-attribution`), which credits a creator for referring a
 * *sale* and funds `CREATOR_COMMISSION`. This one credits a seller for
 * referring another *seller*, funds `REFERRAL_FEE`, and is a lifetime fact
 * about the referred seller rather than a per-order one.
 *
 * Kept container-free like `utils/dunning.ts` and `fee-resolution.ts`, so the
 * earning window and the self-referral rule can be asserted without a database.
 */

export enum ReferralStatus {
  /** The referrer is currently owed a share on the referred seller's orders. */
  ACTIVE = "active",
  /** The earning window has closed; kept for history, pays nothing. */
  EXPIRED = "expired",
  /** Ended early by an operator (fraud, dispute); pays nothing. */
  REVOKED = "revoked",
}

/** How an attribution came to be recorded. */
export enum ReferralSource {
  /** The referred seller named their referrer during onboarding. */
  SELF = "self",
  /** An operator recorded it. */
  ADMIN = "admin",
  /** Resolved from a signup/referral code. */
  SIGNUP_CODE = "signup_code",
  /** Backfilled from pre-existing data. */
  MIGRATION = "migration",
}

/**
 * How long after attribution a referrer keeps earning, in days.
 *
 * A finite window is the point of the whole feature: a referral is a
 * one-time act, and paying a share forever would turn every early seller into
 * a permanent tax on someone else's sales. Twelve months matches the paid-plan
 * annual cycle. `null` `expires_at` on a row means "no window" (an operator
 * grant that should not lapse) and is handled explicitly by `isReferralEarning`.
 */
export const REFERRAL_EARNING_WINDOW_DAYS = 365

/** The moment a referral attributed at `attributedAt` stops earning. */
export function referralExpiryFrom(attributedAt: Date): Date {
  return new Date(
    attributedAt.getTime() + REFERRAL_EARNING_WINDOW_DAYS * 24 * 60 * 60 * 1000
  )
}

/** The subset of a referral row the earning rule reads. */
export type ReferralEarningState = {
  status: ReferralStatus | string
  referrer_seller_id: string
  referred_seller_id: string
  /** Null means the grant never lapses on its own. */
  expires_at?: Date | string | null
}

/**
 * Is this referral owed a share on an order settling `now`?
 *
 * Three ways to earn nothing, checked explicitly rather than left to a status
 * that a cron might not have flipped yet:
 *   - the status is not `active` (expired or revoked),
 *   - the earning window has closed (`now >= expires_at`),
 *   - the referrer is the referred seller (a self-referral that slipped past
 *     the write guard must still never pay out).
 *
 * The expiry is evaluated here rather than trusted from `status` so a lapsed
 * referral stops paying the instant its window closes, even before the
 * housekeeping job has marked it `expired` — the same auto-lapsing posture the
 * threshold privileges take.
 */
export function isReferralEarning(
  referral: ReferralEarningState,
  now: Date
): boolean {
  if (referral.status !== ReferralStatus.ACTIVE) return false
  if (referral.referrer_seller_id === referral.referred_seller_id) return false
  if (!referral.referrer_seller_id) return false

  if (referral.expires_at != null) {
    const expires =
      referral.expires_at instanceof Date
        ? referral.expires_at
        : new Date(referral.expires_at)
    if (!Number.isNaN(expires.getTime()) && now.getTime() >= expires.getTime()) {
      return false
    }
  }

  return true
}

/**
 * Would attributing `referred` to `referrer` be a valid, self-consistent
 * referral? Used at the write boundary; the DB CHECK is the backstop.
 */
export function isValidAttribution(
  referredSellerId: string,
  referrerSellerId: string
): boolean {
  return (
    !!referredSellerId &&
    !!referrerSellerId &&
    referredSellerId !== referrerSellerId
  )
}
