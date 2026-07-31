import { mapSubscriptionTier } from "../models/blackout-events"

/**
 * `mapSubscriptionTier` must accept both the §3 wire vocabulary
 * (signal/signal_plus/community) and Blackout's consumer-tier names
 * (signal/coalition/sovereign) that the first-party catalog labels listings with.
 * Regression: Coalition and Sovereign used to collapse silently to `signal`.
 */
describe("mapSubscriptionTier", () => {
  it("passes wire tiers through unchanged", () => {
    expect(mapSubscriptionTier({ blackout_tier: "signal" })).toBe("signal")
    expect(mapSubscriptionTier({ blackout_tier: "signal_plus" })).toBe("signal_plus")
    expect(mapSubscriptionTier({ blackout_tier: "community" })).toBe("community")
  })

  it("translates consumer-tier names from the first-party catalog", () => {
    expect(mapSubscriptionTier({ blackout_tier: "signal" })).toBe("signal")
    expect(mapSubscriptionTier({ blackout_tier: "coalition" })).toBe("signal_plus")
    expect(mapSubscriptionTier({ blackout_tier: "sovereign" })).toBe("community")
  })

  it("maps free to signal", () => {
    expect(mapSubscriptionTier({ blackout_tier: "free" })).toBe("signal")
  })

  it("defaults unknown / missing metadata to signal", () => {
    expect(mapSubscriptionTier({ blackout_tier: "mystery" })).toBe("signal")
    expect(mapSubscriptionTier({})).toBe("signal")
    expect(mapSubscriptionTier(null)).toBe("signal")
    expect(mapSubscriptionTier(undefined)).toBe("signal")
    expect(mapSubscriptionTier({ blackout_tier: 42 })).toBe("signal")
  })
})
