/**
 * What a vault document currently proves.
 *
 * Pure. `vault_document` has carried `expires_at` since its first migration
 * and, until 2026-09-03, nothing read it: the vendor panel printed the date
 * in a cell and every consumer — the quest predicates, the compliance
 * tracker, the wellness-insurance packet — tested `verified` alone. That was
 * masked by a worse defect: `markVerified` had no caller, so no document
 * could ever be verified and the "expired but still shows as verified" bug
 * could not yet happen.
 *
 * `PATCH /admin/vault/:id` now gives `markVerified` its first caller, which
 * is exactly the moment the expiry rule has to exist. A certificate of
 * insurance that lapsed last month and still reads `verified: true` is worse
 * than no certificate at all, because someone relied on it.
 *
 * `verified` stays a stored fact ("an admin checked this on this date").
 * `effective_status` is derived from it and the clock, never stored — the
 * same reasoning that keeps `overdue` derived in accounts-receivable. An
 * admin's check does not become false when a date passes; what becomes
 * false is the document's current standing, and that is what readers ask.
 */

export type EffectiveDocumentStatus = "unverified" | "verified" | "expired"

export type VaultDocumentLike = {
  verified?: boolean | null
  verified_at?: Date | string | null
  expires_at?: Date | string | null
}

const asDate = (value: Date | string | null | undefined): Date | null => {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Has the document's coverage window closed?
 *
 * Only a document with an expiry can expire; one with none is open-ended by
 * the vendor's own statement. Compared at the instant, not the calendar day:
 * an insurance certificate states a time, and "expires at 23:59 on the 30th"
 * is a real thing that an end-of-day rounding would extend by up to a day.
 */
export function isDocumentExpired(doc: VaultDocumentLike, now: Date): boolean {
  const expires = asDate(doc.expires_at)
  if (!expires) return false
  return now.getTime() > expires.getTime()
}

/**
 * Verified AND not expired — the only state a consumer should treat as
 * evidence. `verified` on its own is not enough, and every predicate that
 * gates on documents should call this rather than reading the column.
 */
export function isDocumentCurrent(doc: VaultDocumentLike, now: Date): boolean {
  return doc.verified === true && !isDocumentExpired(doc, now)
}

export function effectiveDocumentStatus(
  doc: VaultDocumentLike,
  now: Date
): EffectiveDocumentStatus {
  if (doc.verified !== true) return "unverified"
  return isDocumentExpired(doc, now) ? "expired" : "verified"
}

/** Whole days until expiry; negative once past; null when open-ended. */
export function daysUntilExpiry(doc: VaultDocumentLike, now: Date): number | null {
  const expires = asDate(doc.expires_at)
  if (!expires) return null
  return Math.floor((expires.getTime() - now.getTime()) / (24 * 60 * 60 * 1000))
}
