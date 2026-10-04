/**
 * Which platform fee applies to a seller, and why.
 *
 * Pure — no container, no I/O — mirroring the `modules/subscription/utils/dunning.ts`
 * precedent, so the precedence rule can be asserted directly without a database.
 *
 * There are four possible sources and they are strictly ordered:
 *
 *   0. **The transaction kind.** A donation (or a donation pledge) carries a 0%
 *      platform fee by rule, whoever the seller is and whatever they negotiated.
 *      This is a decision about what FBM charges for, not a rate, which is why
 *      it sits ABOVE the override: a per-seller concession is a negotiable
 *      number, the donation rule is not. It also means plan and override are
 *      never consulted for a donation, so a 0% donation can never be mistaken
 *      for the `seller_override: 0` concession or leak a plan rate.
 *   1. **A per-seller override** (`seller_payout_settings.custom_platform_fee_percent`),
 *      while it is unexpired. This is a negotiated or promotional concession made
 *      to one seller and must beat everything else below it — otherwise moving a
 *      seller onto a plan would silently revoke a rate someone agreed to.
 *   2. **The seller's billing plan's rate**, when the plan expresses one.
 *   3. **The platform default** (`payout_config.platform_fee_percent`).
 *
 * The plan is deliberately consulted BELOW the override rather than written into
 * the settings row. Writing the plan's rate into `custom_platform_fee_percent`
 * would make that column permanently ambiguous — nothing downstream could then
 * tell a negotiated concession from a plan rate, and a plan change could not
 * safely overwrite it. For the same reason the kind rule is not a plan row and
 * not an override of 0: `modules/vendor-plan/catalog.ts` only ever discounts a
 * sale, and `__tests__/catalog.unit.spec.ts` would be the wrong guard for a
 * rule about what is being charged.
 *
 * This function is unconditional. Whether a caller may classify a charge as a
 * donation at all is decided at the container composition point
 * (`shared/platform-fee.ts`), behind `FF_NONPROFIT_PARITY_V1`.
 */

/** Where a resolved fee came from. */
export type PlatformFeeSource =
  | "transaction_kind"
  | "seller_override"
  | "plan"
  | "platform_default"

/**
 * What is being charged for.
 *
 * `sale` is every goods-or-services purchase and the default when a caller says
 * nothing. `donation` is a direct charge to a partner org; `donation_pledge` is
 * a donation promised ahead of collection. `donation_pledge` is deliberately
 * NOT `pledge`: a collective-campaign backing (PRE_ORDER / MICRO_INVESTOR) and
 * a demand-pool participant commitment are also called pledges and keep their
 * own fee paths (`services/collective-hawala.ts`, the demand-pool admin route)
 * — a blanket "pledges are free" rule would zero revenue on goods pre-orders
 * and group buys and reach into securities-gated flows.
 *
 * `tip` exists so the kind set is complete, but no caller passes it: tips are
 * kept out of the fee base by `calculateBreakdown` (they are never part of
 * `seller.subtotal`) and that stays the one mechanism. Two mechanisms for one
 * outcome is how a tip ends up both excluded and classified.
 */
export type PlatformFeeTransactionKind =
  | "sale"
  | "donation"
  | "donation_pledge"
  | "tip"
  | "pool_contribution"

/**
 * Kinds the platform takes no fee on, by rule rather than by negotiation.
 *
 * `pool_contribution` (docs/BMC_SURVIVAL_PROGRAMS.md Decision 7, Phase 1b
 * slice S14) is a contribution to a nonprofit-carried investment pool,
 * collected as a direct charge ON the carrier's own connected account. BMC
 * takes 0 for the same mechanical reason it takes 0 on a donation: a direct
 * charge cannot carry a platform cut without `application_fee_amount`, which
 * routes funds through FBM's balance and is forbidden (L24). Decision 1 named
 * donations, pledges and tips; extending the 0 to carried-pool contributions
 * by the same mechanism is recorded as an assumption for the operator.
 */
export const ZERO_FEE_TRANSACTION_KINDS: ReadonlySet<PlatformFeeTransactionKind> =
  new Set<PlatformFeeTransactionKind>(["donation", "donation_pledge", "tip", "pool_contribution"])

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
  /** What is being charged for. Defaults to `sale`. */
  kind?: PlatformFeeTransactionKind
}): ResolvedPlatformFee {
  const kind = input.kind ?? "sale"
  if (ZERO_FEE_TRANSACTION_KINDS.has(kind)) {
    // Above the override on purpose (see the header). Nothing below is read:
    // the override is not consulted, so it cannot be reported as expired, and
    // the plan is not consulted, so its rate is neither applied nor leaked.
    return {
      percent: 0,
      source: "transaction_kind",
      override_expired: false,
      override_reason: null,
    }
  }

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
