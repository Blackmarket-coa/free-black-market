/**
 * Wholesale pricing helper (v1).
 *
 * `POST /store/carts/:id/wholesale` applies the buyer's vendor-customer-tier
 * percentage discount (modules/vendor-rules `VendorCustomerTier.discount_percent`)
 * to the cart's line items, and gates the apply on the seller's order
 * minimums (`vendor_rules.min_order_value` / `min_order_items` — the MOQ
 * gate, waivable per tier via `waive_order_minimum`).
 *
 * v1 scope is deliberately narrow: percentage tier discount + MOQ gate.
 * docs/LISTING_TYPES.md's `wholesale` listing-type additionally specifies
 * per-product quantity brackets (`tier_pricing: [{min_qty, price_per_unit}]`);
 * brackets can layer on top later — resolve a bracket price per item first,
 * then fall back to the percentage path — without changing these signatures.
 *
 * All prices are integer minor units (cents for USD). The cart route stashes
 * the original listed price on line-item metadata under the shared
 * `BASE_UNIT_PRICE_METADATA_KEY` from lib/sliding-scale.ts so wholesale and
 * sliding-scale repricing always derive from the same base and never
 * compound each other (or themselves on re-apply).
 */

/**
 * Line-item metadata key recording the wholesale discount percent applied to
 * the item, for idempotent re-application (mirrors `sliding_scale_tier`).
 */
export const WHOLESALE_DISCOUNT_METADATA_KEY = "wholesale_discount_percent"

/**
 * Apply a percentage discount to a base minor-unit price. Rounds half-up to
 * the nearest minor unit (Math.round, consistent with lib/sliding-scale.ts).
 *
 * Guards: non-finite or negative base returns 0 (we never write a negative
 * price); the discount is clamped to [0, 100] — NaN or a discount <= 0
 * means "no discount" (returns the rounded base), anything above 100 %
 * (including Infinity) floors the price at 0.
 */
export function computeWholesaleUnitPriceMinor(
  baseUnitPriceMinor: number,
  discountPercent: number
): number {
  if (!Number.isFinite(baseUnitPriceMinor) || baseUnitPriceMinor < 0) return 0
  const base = Math.round(baseUnitPriceMinor)
  if (Number.isNaN(discountPercent) || discountPercent <= 0) return base
  const discount = Math.min(discountPercent, 100)
  return Math.max(0, Math.round((base * (100 - discount)) / 100))
}

export interface WholesaleMinimumItem {
  quantity: number
  unitPriceMinor: number
}

export interface WholesaleMinimumShortfall {
  code: "min_order_value" | "min_order_items"
  /** For min_order_value both numbers are minor units; for min_order_items, item counts. */
  required: number
  actual: number
}

export interface WholesaleMinimumCheckResult {
  ok: boolean
  unmet: WholesaleMinimumShortfall[]
}

/**
 * Check a seller's order minimums (the MOQ gate) against the items the buyer
 * is ordering from that seller.
 *
 * Mirrors VendorRulesService.validateOrder semantics: `min_order_value`
 * engages when > 0, `min_order_items` when > 1 (the default of 1 is a
 * no-op), and a tier with `waive_order_minimum` skips both checks. The item
 * count sums quantities (fractional quantities — weight items — count as
 * their fraction); the value check sums quantity × unit price in minor
 * units. Garbage (non-finite / negative) quantities or prices count as 0.
 */
export function checkWholesaleMinimums(input: {
  items: WholesaleMinimumItem[]
  minOrderItems: number
  minOrderValueMinor: number
  waive?: boolean
}): WholesaleMinimumCheckResult {
  if (input.waive === true) return { ok: true, unmet: [] }

  let itemCount = 0
  let subtotalMinor = 0
  for (const item of input.items ?? []) {
    const qty =
      Number.isFinite(item?.quantity) && item.quantity > 0 ? item.quantity : 0
    const unit =
      Number.isFinite(item?.unitPriceMinor) && item.unitPriceMinor > 0
        ? Math.round(item.unitPriceMinor)
        : 0
    itemCount += qty
    subtotalMinor += unit * qty
  }
  subtotalMinor = Math.round(subtotalMinor)

  const minItems = Number.isFinite(input.minOrderItems)
    ? input.minOrderItems
    : 0
  const minValueMinor = Number.isFinite(input.minOrderValueMinor)
    ? input.minOrderValueMinor
    : 0

  const unmet: WholesaleMinimumShortfall[] = []
  if (minValueMinor > 0 && subtotalMinor < minValueMinor) {
    unmet.push({
      code: "min_order_value",
      required: minValueMinor,
      actual: subtotalMinor,
    })
  }
  if (minItems > 1 && itemCount < minItems) {
    unmet.push({ code: "min_order_items", required: minItems, actual: itemCount })
  }

  return { ok: unmet.length === 0, unmet }
}
