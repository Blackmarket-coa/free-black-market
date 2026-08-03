/**
 * Promoted listings: the `featured` flag as a time-bound entitlement.
 *
 * `seller_metadata.featured` is a plain boolean, indexed, and already drives
 * `order: { featured: "DESC" }` in `api/store/directory` and the vendor
 * listings. It is real placement with real value — but nothing about it is
 * sellable today: it has no owner, no price, no expiry, and its only writer is
 * an admin form. Once set it stays set forever.
 *
 * This makes a promotion an `ACCESS_PASS` entitlement (`seller_id` +
 * `expires_at`, both of which the entitlement model already carries) and
 * demotes `featured` to a **derived read flag**. The entitlement is the truth;
 * the boolean is a denormalized copy kept in sync so the five indexed
 * `featured` columns and their `ORDER BY`s keep working untouched.
 *
 * Why not query entitlements at read time instead? The directory sorts on
 * `featured` inside the same query that filters and pages the catalog. Moving
 * that to a join against `entitlement` would make the public catalog's hottest
 * query depend on the entitlement table, for a value that changes at most twice
 * per promotion. Denormalizing and sweeping is the cheaper, duller option.
 */

/** The entitlement feature key a promotion grants. */
export const PROMOTED_LISTING_FEATURE_KEY = "vendor.promoted_listing"

export type PromotionTier = {
  code: string
  display_name: string
  description: string
  duration_days: number
  /** Minor units (cents). */
  price_amount: number
  currency_code: string
}

/**
 * Purchasable promotion durations.
 *
 * Priced per-day-descending so a longer commitment is cheaper per day, which is
 * the only pricing shape that makes the longer tiers worth offering at all.
 */
export const PROMOTION_TIERS: PromotionTier[] = [
  {
    code: "week",
    display_name: "1 week",
    description: "Featured placement in the vendor directory for 7 days.",
    duration_days: 7,
    price_amount: 1500,
    currency_code: "usd",
  },
  {
    code: "month",
    display_name: "1 month",
    description: "Featured placement in the vendor directory for 30 days.",
    duration_days: 30,
    price_amount: 4900,
    currency_code: "usd",
  },
  {
    code: "quarter",
    display_name: "3 months",
    description: "Featured placement in the vendor directory for 90 days.",
    duration_days: 90,
    price_amount: 12900,
    currency_code: "usd",
  },
]

export function getPromotionTier(code: string | null | undefined): PromotionTier | null {
  if (!code) return null
  return PROMOTION_TIERS.find((t) => t.code === code) ?? null
}

/**
 * When a promotion granted now should end.
 *
 * Extends from the later of "now" and any existing expiry, so buying a second
 * week while a week is still running adds seven days rather than overwriting
 * the remaining time — a vendor who renews early must not lose what they
 * already paid for.
 */
export function promotionExpiryFrom(
  durationDays: number,
  now: Date,
  currentExpiry?: Date | string | null
): Date {
  const base = (() => {
    if (!currentExpiry) return now
    const existing =
      currentExpiry instanceof Date ? currentExpiry : new Date(currentExpiry)
    if (Number.isNaN(existing.getTime())) return now
    return existing.getTime() > now.getTime() ? existing : now
  })()

  return new Date(base.getTime() + durationDays * 86_400_000)
}

/** Is a promotion with this expiry still running? A null expiry never ends. */
export function isPromotionActive(
  expiresAt: Date | string | null | undefined,
  now: Date
): boolean {
  if (expiresAt === null || expiresAt === undefined) return true
  const date = expiresAt instanceof Date ? expiresAt : new Date(expiresAt)
  // An unparseable expiry is treated as expired: the alternative is a
  // corrupt value buying permanent free placement.
  if (Number.isNaN(date.getTime())) return false
  return date.getTime() > now.getTime()
}

/**
 * What the sweep should do about one seller's `featured` flag.
 *
 * - `"set"` / `"clear"` — write the flag.
 * - `"none"` — the flag already agrees; skip the write. The sweep runs over
 *   every promoted seller and must not rewrite rows that have not changed.
 * - `"unbacked"` — the seller is featured with no promotion entitlement behind
 *   it. **Reported, never cleared.**
 *
 * That last case is the whole reason this returns an action rather than a
 * boolean. Every `featured` row today was set by hand through the admin form,
 * before promotions existed. A sweep that treated "no entitlement" as "not
 * entitled" would demote every currently-featured vendor the first time it ran
 * — a silent, live change to who appears at the top of the public directory,
 * caused by a background job nobody was watching.
 *
 * So the sweep is deliberately one-directional for unbacked flags: it can only
 * end promotions it can see the record of. `scripts/backfill-promoted-listings.ts`
 * converts the hand-set flags into open-ended operator promotions; until an
 * operator runs it, those vendors keep their placement and show up in this
 * report.
 */
export type FeaturedFlagAction = "set" | "clear" | "none" | "unbacked"

export function featuredFlagAction(input: {
  currentFeatured: boolean
  expiresAt: Date | string | null | undefined
  /** False when the seller holds no promotion entitlement at all. */
  hasPromotion: boolean
  now: Date
}): FeaturedFlagAction {
  if (!input.hasPromotion) {
    return input.currentFeatured ? "unbacked" : "none"
  }

  const shouldBeFeatured = isPromotionActive(input.expiresAt, input.now)
  if (shouldBeFeatured === input.currentFeatured) return "none"
  return shouldBeFeatured ? "set" : "clear"
}
