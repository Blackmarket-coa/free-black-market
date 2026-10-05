/**
 * Pure grace-period decisions for the F4 lifecycle
 * (docs/BLACK_MASK_LAUNCH_PLAN.md §5 F4: "cancellation or failed payment
 * starts a grace period (length open), then read-only access with export.
 * Never quick deletion.").
 *
 * **The grace length is a setting, never a constant.** There is deliberately
 * no default number anywhere in this file: the platform default comes from
 * `SUBSCRIPTION_GRACE_PERIOD_DAYS`, a product may override it with
 * `metadata.subscription_grace_period_days`, and when neither is configured
 * `resolveGracePeriodDays` returns null and the caller keeps today's behaviour
 * for that transition (and logs) rather than inventing a length.
 *
 * Kept free of any container so it is unit-testable on its own, alongside the
 * sibling `dunning.ts`.
 */

export const GRACE_PERIOD_ENV = "SUBSCRIPTION_GRACE_PERIOD_DAYS"
export const GRACE_PERIOD_PRODUCT_METADATA_KEY = "subscription_grace_period_days"
export const UNTIL_CANCELED_PRODUCT_METADATA_KEY = "subscription_until_canceled"

/** Why a subscription entered grace. Stored on metadata.grace_reason. */
export type GraceReason = "payment_failed" | "customer_canceled"

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Parse a configured grace length. Accepts a non-negative whole number of
 * days, as a number or a numeric string (product metadata edited through the
 * admin arrives as strings). Anything else — empty, negative, fractional,
 * non-numeric — is "not configured", never coerced to some number.
 *
 * Zero is a configured value: it means "no grace", i.e. read-only at the
 * moment grace would have started (or, for a cancel, at period end).
 */
export function parseGraceDays(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw === "number") {
    return Number.isInteger(raw) && raw >= 0 ? raw : null
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim()
    if (!/^\d+$/.test(trimmed)) return null
    const n = Number(trimmed)
    return Number.isSafeInteger(n) ? n : null
  }
  return null
}

export type GracePeriodResolution =
  | { days: number; source: "product" | "platform" }
  | null

/**
 * Per-product override first, then the platform default; null when neither is
 * a valid configured value.
 */
export function resolveGracePeriodDays(args: {
  product_metadata?: Record<string, unknown> | null
  platform_default?: string | null | undefined
}): GracePeriodResolution {
  const override = parseGraceDays(
    args.product_metadata?.[GRACE_PERIOD_PRODUCT_METADATA_KEY]
  )
  if (override !== null) return { days: override, source: "product" }

  const platform = parseGraceDays(args.platform_default)
  if (platform !== null) return { days: platform, source: "platform" }

  return null
}

/** `start` plus a whole number of days. */
export function graceEndsAt(start: Date, days: number): Date {
  return new Date(start.getTime() + days * DAY_MS)
}

/**
 * When grace starts for a customer cancel: the end of the period the customer
 * already paid for, or now if that is in the past or unknown. Access continues
 * through the paid period plus grace.
 */
export function cancelGraceStart(
  nextOrderDate: Date | string | null | undefined,
  now: Date
): Date {
  if (!nextOrderDate) return new Date(now)
  const paidThrough = new Date(nextOrderDate)
  if (Number.isNaN(paidThrough.getTime())) return new Date(now)
  return paidThrough.getTime() > now.getTime() ? paidThrough : new Date(now)
}

/** Grace is over when `grace_ends_at` is at or before `now`. */
export function isGraceExpired(
  graceEnds: Date | string | null | undefined,
  now: Date
): boolean {
  if (!graceEnds) return false
  const t = new Date(graceEnds).getTime()
  return !Number.isNaN(t) && t <= now.getTime()
}

/**
 * Product metadata opts a product into until-canceled subscriptions. Literal
 * `true`, or the string "true" (admin-edited metadata is stringly typed).
 */
export function isUntilCanceledProduct(
  metadata: Record<string, unknown> | null | undefined
): boolean {
  const v = metadata?.[UNTIL_CANCELED_PRODUCT_METADATA_KEY]
  return v === true || v === "true"
}
