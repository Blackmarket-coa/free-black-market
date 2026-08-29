import {
  BLACKOUT_SUBSCRIPTION_TIERS,
  mapSubscriptionTier,
} from "../../modules/marketplace-webhooks/models/blackout-events"
import { CANDIDATES } from "../../scripts/seed-blackout-catalog"
import { CreatorListingStatus } from "../../modules/marketplace-listing/models"

/**
 * THE canonical tier-mapping table (W1b). Three vocabularies exist and have
 * drifted before (a documented past bug):
 *   - consumer tier names the catalog + Blackout UI use: signal | coalition | sovereign
 *   - §3 wire tiers Blackout's bridge consumes:          signal | signal_plus | community
 *   - Canopy platform plan codes (Blackout-side gating): sprout | canopy_pro (× monthly/annual)
 * Every mapping between them is pinned HERE, in one table. If a vocabulary
 * changes, change this table and the code together.
 */
const TIER_TABLE: Array<{
  listingMetadataTier: string
  wireTier: (typeof BLACKOUT_SUBSCRIPTION_TIERS)[number]
}> = [
  // Consumer catalog names (seed-blackout-catalog metadata.blackout_tier)
  { listingMetadataTier: "signal", wireTier: "signal" },
  { listingMetadataTier: "coalition", wireTier: "signal_plus" },
  { listingMetadataTier: "sovereign", wireTier: "community" },
  // Wire names pass through unchanged
  { listingMetadataTier: "signal_plus", wireTier: "signal_plus" },
  { listingMetadataTier: "community", wireTier: "community" },
  // Legacy/fallbacks
  { listingMetadataTier: "free", wireTier: "signal" },
]

/** Canopy plan codes ↔ first-party draft listings (billing only; feature
 *  gating for Canopy stays Blackout-side, so wire tier is the default). */
const CANOPY_PLAN_CODES = [
  "sprout_monthly",
  "sprout_annual",
  "canopy_pro_monthly",
  "canopy_pro_annual",
] as const

describe("canonical Blackout tier-mapping table", () => {
  it("maps every table row through mapSubscriptionTier", () => {
    for (const row of TIER_TABLE) {
      expect(mapSubscriptionTier({ blackout_tier: row.listingMetadataTier })).toBe(
        row.wireTier
      )
    }
  })

  it("defaults unknown/absent tiers to signal (matching Blackout's fromFbmTier)", () => {
    expect(mapSubscriptionTier({ blackout_tier: "sprout" })).toBe("signal")
    expect(mapSubscriptionTier({ blackout_tier: "no-such-tier" })).toBe("signal")
    expect(mapSubscriptionTier({})).toBe("signal")
    expect(mapSubscriptionTier(null)).toBe("signal")
  })

  it("seeds exactly one PUBLISHED consumer-tier listing per consumer tier", () => {
    const tiers = CANDIDATES.filter((c) => c.tier)
    expect(tiers.map((c) => c.tier).sort()).toEqual([
      "coalition",
      "signal",
      "sovereign",
    ])
    for (const c of tiers) {
      expect(c.category).toBe("subscription")
      expect(c.status ?? CreatorListingStatus.PUBLISHED).toBe(
        CreatorListingStatus.PUBLISHED
      )
      expect(c.interval).toBe("monthly")
      expect(c.price_cents).toBeGreaterThan(0)
    }
  })

  it("seeds exactly the four Canopy plan placeholders as unpriced DRAFTs", () => {
    const canopy = CANDIDATES.filter(
      (c) => typeof c.extra_metadata?.canopy_plan_code === "string"
    )
    expect(
      canopy.map((c) => c.extra_metadata!.canopy_plan_code).sort()
    ).toEqual([...CANOPY_PLAN_CODES].sort())
    for (const c of canopy) {
      // Placeholders MUST NOT be purchasable until an operator prices and
      // publishes them (MONETIZATION_GO_LIVE) — the checkout route rejects
      // unpublished/unpriced listings.
      expect(c.status).toBe(CreatorListingStatus.DRAFT)
      expect(c.price_cents).toBe(0)
      expect(c.category).toBe("subscription")
      expect(c.feature_keys).toEqual([])
    }
  })

  it("every subscription-category seed carries a recurrence shape", () => {
    for (const c of CANDIDATES.filter((c) => c.category === "subscription")) {
      expect(c.interval).toBeDefined()
      expect(c.period_days).toBeGreaterThan(0)
    }
  })
})
