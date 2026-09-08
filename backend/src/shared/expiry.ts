/**
 * The one day-count convention.
 *
 * Expiry arithmetic had been written four times before this file existed, and
 * the 2026-09-08 audit found the copies did not agree:
 *
 *   - `modules/document-vault/document-status.ts` — `Math.floor(Δ / 86_400_000)`,
 *     expired when `now > expires_at`, compared at the instant.
 *   - `modules/cottage-food/utils/time.ts` `daysUntil` — `Math.floor(Δ / MS_PER_DAY)`.
 *     Identical to the vault's, arrived at independently.
 *   - `api/vendor/farm/profile/route.ts` — `Math.ceil(Δ / 86_400_000)`, expired
 *     when `days_remaining < 0`. **Different, and wrong.**
 *   - `modules/vendor-verification/service.ts` `processExpirations` — no day
 *     count at all, just `new Date(expires_at) < now`.
 *
 * So there were two conventions, not three, and one of them had a real defect.
 * `Math.ceil` maps every instant in the 24 hours *after* expiry to `-0`, and
 * `-0 < 0` is false, so a certification that lapsed at any point in the last
 * day reported `days_remaining: 0, status: "expiring_soon"` — still valid — for
 * a further 24 hours. `Math.floor` returns `-1` there and reads as expired.
 *
 * `floor` is therefore the convention, and it is the one two of the three
 * existing day counts already used. Read it as "whole days still to run":
 * `0` means "expires at some point today, but has not yet"; anything negative
 * means it is gone.
 */

export const MS_PER_DAY = 86_400_000

/**
 * Coerce the loose shapes expiry dates arrive in. Returns null for absent and
 * for unparseable values alike — an expiry nobody can read is not an expiry,
 * and every caller here treats "no date" as open-ended rather than as expired.
 */
export function asExpiryDate(
  value: Date | string | number | null | undefined
): Date | null {
  if (value === null || value === undefined || value === "") return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * Whole days from `now` until `date`. Negative once the date has passed.
 *
 * `Math.floor`, deliberately — see the file docblock. Matches
 * `document-vault`'s `daysUntilExpiry` and `cottage-food`'s `daysUntil`
 * exactly, so adopting this changes neither of their answers.
 */
export function daysUntil(date: Date, now: Date): number {
  return Math.floor((date.getTime() - now.getTime()) / MS_PER_DAY)
}

/**
 * Has the moment passed?
 *
 * Compared at the instant rather than rounded to the calendar day, which is
 * `document-vault`'s rule and its reasoning: "an insurance certificate states
 * a time, and 'expires at 23:59 on the 30th' is a real thing that an
 * end-of-day rounding would extend by up to a day."
 *
 * Note this is strictly finer than `daysUntil(...) < 0`: in the hours after
 * expiry both agree, but a document expiring later *today* is `isExpired:
 * false` with `daysUntil: 0`. That is the intended reading — it has not
 * lapsed yet, and it is the last day on which anything can be done about it.
 */
export function isExpired(date: Date, now: Date): boolean {
  return now.getTime() > date.getTime()
}
