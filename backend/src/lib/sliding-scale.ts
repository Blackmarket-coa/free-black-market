/**
 * Sliding-scale pricing helper.
 *
 * The storefront writes the buyer's tier choice to `cart.metadata.tier`.
 * `POST /store/carts/:id/tier` reads each line item's product, decides
 * whether sliding scale applies (the seller's playbook must allow it),
 * and overrides the line item's `unit_price` for the chosen tier.
 *
 * Two override mechanisms, in order of precedence:
 *   1. Explicit per-tier prices in product metadata:
 *        product.metadata.sliding_scale_prices_minor = {
 *          supporter:  <minor units>,
 *          standard:   <minor units>,
 *          solidarity: <minor units>,
 *        }
 *      A vendor can set absolute prices per tier here. Standard tier is
 *      typically the listed price (we still record it for symmetry).
 *
 *   2. Multiplier in basis points (1 bp = 0.01 %):
 *        product.metadata.sliding_scale_multipliers_bps = {
 *          supporter:  <bps, e.g. 12500 = +25 %>,
 *          standard:   <bps, e.g. 10000 = listed>,
 *          solidarity: <bps, e.g.  6500 = -35 %>,
 *        }
 *      If absent, DEFAULT_TIER_MULTIPLIERS_BPS is used.
 *
 * Eligibility is gated upstream: only products whose seller is on a
 * playbook with `allow_sliding_scale: true` participate (every playbook
 * except Stall — see backend/src/modules/playbook/recipes/*).
 *
 * Posture A note: this is a buyer-facing UX layer. The choice records on
 * cart/order metadata for downstream patronage accounting, but does not
 * itself create a transferable claim or modify the CCR closed-loop
 * invariants enforced in modules/hawala-ledger/posture-a-guard.
 */

export type SlidingScaleTier = "supporter" | "standard" | "solidarity"

export const SLIDING_SCALE_TIERS: readonly SlidingScaleTier[] = [
  "supporter",
  "standard",
  "solidarity",
] as const

/**
 * Default platform-wide multipliers. Picked to land roughly symmetric
 * around the standard tier so a 1:1 supporter/solidarity ratio
 * approximately covers the discount.
 *
 * Vendors can override per-product via `sliding_scale_multipliers_bps`.
 */
export const DEFAULT_TIER_MULTIPLIERS_BPS: Record<SlidingScaleTier, number> = {
  supporter: 12500, // +25 %
  standard: 10000, // listed
  solidarity: 6500, // -35 %
}

export const BASE_UNIT_PRICE_METADATA_KEY = "sliding_scale_base_unit_price_minor"

/**
 * Currency the stashed base price (BASE_UNIT_PRICE_METADATA_KEY) was captured
 * in. The base is only valid while the cart stays in this currency; on a
 * region/currency switch a stale base must not be reused (it would price the
 * new-currency line off the old currency's amount).
 */
export const BASE_CURRENCY_METADATA_KEY = "sliding_scale_base_currency"

export function isSlidingScaleTier(value: unknown): value is SlidingScaleTier {
  return (
    typeof value === "string" &&
    (SLIDING_SCALE_TIERS as readonly string[]).includes(value)
  )
}

/**
 * Resolve the bps multiplier for a tier given the product's metadata.
 * Falls back to DEFAULT_TIER_MULTIPLIERS_BPS if no override is set.
 */
export function resolveTierMultiplierBps(
  tier: SlidingScaleTier,
  productMetadata: Record<string, unknown> | null | undefined
): number {
  const overrides = (productMetadata?.sliding_scale_multipliers_bps ?? null) as
    | Record<string, unknown>
    | null
  const candidate = overrides?.[tier]
  if (
    typeof candidate === "number" &&
    Number.isFinite(candidate) &&
    candidate > 0
  ) {
    return candidate
  }
  return DEFAULT_TIER_MULTIPLIERS_BPS[tier]
}

/**
 * Resolve an explicit per-tier price (in minor units) from product
 * metadata, or `null` if not set. When non-null, this beats the
 * multiplier path entirely.
 */
export function resolveTierAbsolutePriceMinor(
  tier: SlidingScaleTier,
  productMetadata: Record<string, unknown> | null | undefined
): number | null {
  const explicit = (productMetadata?.sliding_scale_prices_minor ?? null) as
    | Record<string, unknown>
    | null
  const candidate = explicit?.[tier]
  if (
    typeof candidate === "number" &&
    Number.isFinite(candidate) &&
    candidate >= 0
  ) {
    return Math.round(candidate)
  }
  return null
}

/**
 * Apply a bps multiplier to a base minor-unit price. Rounds to the
 * nearest minor unit (half-up via Math.round). Negative or non-finite
 * inputs return 0 — by construction we never write a negative price.
 */
export function applyTierMultiplier(
  basePriceMinor: number,
  multiplierBps: number
): number {
  if (!Number.isFinite(basePriceMinor) || basePriceMinor < 0) return 0
  if (!Number.isFinite(multiplierBps) || multiplierBps <= 0) return 0
  return Math.max(0, Math.round((basePriceMinor * multiplierBps) / 10000))
}

/**
 * Compute the adjusted unit price for a tier. Absolute price beats
 * multiplier; multiplier beats default.
 *
 * `basePriceMinor` is the listed (standard-tier) price in the currency's
 * minor units (e.g. cents for USD). Returns the same units.
 */
export function computeTierUnitPriceMinor(
  tier: SlidingScaleTier,
  basePriceMinor: number,
  productMetadata: Record<string, unknown> | null | undefined
): number {
  const explicit = resolveTierAbsolutePriceMinor(tier, productMetadata)
  if (explicit !== null) return explicit

  const bps = resolveTierMultiplierBps(tier, productMetadata)
  return applyTierMultiplier(basePriceMinor, bps)
}
