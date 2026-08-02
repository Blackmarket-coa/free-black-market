/**
 * Which platform fee applies to a seller, and why.
 *
 * Pure — no container, no I/O — mirroring the `modules/subscription/utils/dunning.ts`
 * precedent, so the precedence rule can be asserted directly without a database.
 *
 * There are three possible sources and they are strictly ordered:
 *
 *   1. **A per-seller override** (`seller_payout_settings.custom_platform_fee_percent`),
 *      while it is unexpired. This is a negotiated or promotional concession made
 *      to one seller and must beat everything else — otherwise moving a seller
 *      onto a plan would silently revoke a rate someone agreed to.
 *   2. **The seller's billing plan's rate**, when the plan expresses one.
 *   3. **The platform default** (`payout_config.platform_fee_percent`).
 *
 * The plan is deliberately consulted BELOW the override rather than written into
 * the settings row. Writing the plan's rate into `custom_platform_fee_percent`
 * would make that column permanently ambiguous — nothing downstream could then
 * tell a negotiated concession from a plan rate, and a plan change could not
 * safely overwrite it.
 */

/** Where a resolved fee came from. */
export type PlatformFeeSource = "seller_override" | "plan" | "platform_default"

/** The subset of `seller_payout_settings` this rule reads. */
export type SellerFeeOverride = {
  custom_platform_fee_percent?: number | null
  fee_reduction_expires_at?: Date | string | null
  fee_reduction_reason?: string | null
} | null

export type ResolvedPlatformFee = {
  /** Percentage, e.g. `3` for 3%. */
  percent: number
  source: PlatformFeeSource
  /**
   * True when an override row existed but its validity window had closed. The
   * fee falls through to the next source; this flag is what lets an admin
   * screen say "expired on …" instead of showing nothing.
   */
  override_expired: boolean
  /** Set when the resolved source is the override. */
  override_reason: string | null
}

/**
 * A usable fee percentage, or null.
 *
 * Rejects anything that is not a finite number in [0, 100]. A negative fee would
 * pay a seller MORE than the customer paid, and a >100% fee would produce a
 * negative payout — both are silent money bugs, so a bad value falls through to
 * the next source rather than being clamped into something plausible.
 */
function usablePercent(value: unknown): number | null {
  if (typeof value !== "number") return null
  if (!Number.isFinite(value)) return null
  if (value < 0 || value > 100) return null
  return value
}

function isUnexpired(
  expiresAt: Date | string | null | undefined,
  now: Date
): boolean {
  if (expiresAt === null || expiresAt === undefined) return true
  const date = expiresAt instanceof Date ? expiresAt : new Date(expiresAt)
  if (Number.isNaN(date.getTime())) {
    // An unparseable expiry is treated as expired. Treating it as "never
    // expires" would make a corrupt value grant a permanent discount.
    return false
  }
  return date > now
}

export function resolvePlatformFee(input: {
  override?: SellerFeeOverride
  /** The plan's rate, or null when the plan expresses no opinion. */
  planPercent?: number | null
  platformDefault: number
  now?: Date
}): ResolvedPlatformFee {
  const now = input.now ?? new Date()
  const override = input.override ?? null

  const overridePercent = usablePercent(override?.custom_platform_fee_percent)
  if (overridePercent !== null) {
    if (isUnexpired(override?.fee_reduction_expires_at, now)) {
      return {
        percent: overridePercent,
        source: "seller_override",
        override_expired: false,
        override_reason: override?.fee_reduction_reason ?? null,
      }
    }

    // Expired override: fall through, but say so.
    const fallback = resolveBelowOverride(input.planPercent, input.platformDefault)
    return { ...fallback, override_expired: true, override_reason: null }
  }

  return {
    ...resolveBelowOverride(input.planPercent, input.platformDefault),
    override_expired: false,
    override_reason: null,
  }
}

function resolveBelowOverride(
  planPercent: number | null | undefined,
  platformDefault: number
): Pick<ResolvedPlatformFee, "percent" | "source"> {
  const plan = usablePercent(planPercent)
  if (plan !== null) {
    return { percent: plan, source: "plan" }
  }

  const fallback = usablePercent(platformDefault)
  return {
    // A corrupt platform default is the end of the chain, so there is nothing
    // to fall through to. 0 is the safe direction: undercharging the platform
    // is recoverable, overcharging a seller is not.
    percent: fallback ?? 0,
    source: "platform_default",
  }
}
