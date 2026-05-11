import {
  applyTierMultiplier,
  BASE_UNIT_PRICE_METADATA_KEY,
  computeTierUnitPriceMinor,
  DEFAULT_TIER_MULTIPLIERS_BPS,
  isSlidingScaleTier,
  resolveTierAbsolutePriceMinor,
  resolveTierMultiplierBps,
  SLIDING_SCALE_TIERS,
} from "../sliding-scale"

describe("sliding-scale: invariants", () => {
  it("exposes exactly the three tiers in the documented order", () => {
    expect(SLIDING_SCALE_TIERS).toEqual(["supporter", "standard", "solidarity"])
  })

  it("standard tier defaults to 1:1 (10000 bps)", () => {
    expect(DEFAULT_TIER_MULTIPLIERS_BPS.standard).toBe(10000)
  })

  it("supporter is above and solidarity is below standard", () => {
    expect(DEFAULT_TIER_MULTIPLIERS_BPS.supporter).toBeGreaterThan(
      DEFAULT_TIER_MULTIPLIERS_BPS.standard
    )
    expect(DEFAULT_TIER_MULTIPLIERS_BPS.solidarity).toBeLessThan(
      DEFAULT_TIER_MULTIPLIERS_BPS.standard
    )
  })

  it("exports a stable metadata key for stashing the base price", () => {
    expect(BASE_UNIT_PRICE_METADATA_KEY).toBe("sliding_scale_base_unit_price_minor")
  })
})

describe("sliding-scale: isSlidingScaleTier", () => {
  it.each(["supporter", "standard", "solidarity"])(
    "accepts %s",
    (tier) => {
      expect(isSlidingScaleTier(tier)).toBe(true)
    }
  )

  it.each([
    "Supporter",
    "SUPPORTER",
    "premium",
    "",
    null,
    undefined,
    42,
    {},
    [],
  ])("rejects %p", (val) => {
    expect(isSlidingScaleTier(val)).toBe(false)
  })
})

describe("sliding-scale: resolveTierMultiplierBps", () => {
  it("returns the default when no overrides are set", () => {
    expect(resolveTierMultiplierBps("supporter", null)).toBe(12500)
    expect(resolveTierMultiplierBps("standard", undefined)).toBe(10000)
    expect(resolveTierMultiplierBps("solidarity", {})).toBe(6500)
  })

  it("honours a positive numeric override", () => {
    const md = { sliding_scale_multipliers_bps: { supporter: 13000, solidarity: 7000 } }
    expect(resolveTierMultiplierBps("supporter", md)).toBe(13000)
    expect(resolveTierMultiplierBps("solidarity", md)).toBe(7000)
  })

  it("falls back to the default when an override is missing or invalid", () => {
    const md = {
      sliding_scale_multipliers_bps: {
        supporter: "not a number",
        solidarity: -100,
        // standard intentionally absent
      },
    }
    expect(resolveTierMultiplierBps("supporter", md)).toBe(12500)
    expect(resolveTierMultiplierBps("solidarity", md)).toBe(6500)
    expect(resolveTierMultiplierBps("standard", md)).toBe(10000)
  })
})

describe("sliding-scale: resolveTierAbsolutePriceMinor", () => {
  it("returns null when no explicit per-tier prices are set", () => {
    expect(resolveTierAbsolutePriceMinor("supporter", null)).toBeNull()
    expect(resolveTierAbsolutePriceMinor("supporter", {})).toBeNull()
  })

  it("returns the explicit price when set, rounded to integer minor units", () => {
    const md = { sliding_scale_prices_minor: { supporter: 1250.4, solidarity: 800 } }
    expect(resolveTierAbsolutePriceMinor("supporter", md)).toBe(1250)
    expect(resolveTierAbsolutePriceMinor("solidarity", md)).toBe(800)
  })

  it("accepts a zero price (vendor opts certain tier to free)", () => {
    const md = { sliding_scale_prices_minor: { solidarity: 0 } }
    expect(resolveTierAbsolutePriceMinor("solidarity", md)).toBe(0)
  })

  it("rejects negative explicit prices", () => {
    const md = { sliding_scale_prices_minor: { solidarity: -100 } }
    expect(resolveTierAbsolutePriceMinor("solidarity", md)).toBeNull()
  })
})

describe("sliding-scale: applyTierMultiplier", () => {
  it("computes the standard tier as exactly the base price", () => {
    expect(applyTierMultiplier(2500, 10000)).toBe(2500)
  })

  it("rounds half-up to the nearest minor unit", () => {
    // 2500 * 12500 / 10000 = 3125 exactly
    expect(applyTierMultiplier(2500, 12500)).toBe(3125)
    // 333 * 6500 / 10000 = 216.45 -> 216
    expect(applyTierMultiplier(333, 6500)).toBe(216)
    // 333 * 12500 / 10000 = 416.25 -> 416
    expect(applyTierMultiplier(333, 12500)).toBe(416)
  })

  it("returns 0 for non-finite or negative inputs (never writes negative)", () => {
    expect(applyTierMultiplier(NaN, 10000)).toBe(0)
    expect(applyTierMultiplier(-100, 10000)).toBe(0)
    expect(applyTierMultiplier(100, 0)).toBe(0)
    expect(applyTierMultiplier(100, -100)).toBe(0)
  })
})

describe("sliding-scale: computeTierUnitPriceMinor", () => {
  it("uses the listed price for the standard tier with default multipliers", () => {
    expect(computeTierUnitPriceMinor("standard", 1000, {})).toBe(1000)
  })

  it("applies default multipliers when no overrides are set", () => {
    expect(computeTierUnitPriceMinor("supporter", 1000, {})).toBe(1250)
    expect(computeTierUnitPriceMinor("solidarity", 1000, {})).toBe(650)
  })

  it("absolute price beats multiplier override", () => {
    const md = {
      sliding_scale_prices_minor: { supporter: 1500 },
      sliding_scale_multipliers_bps: { supporter: 30000 },
    }
    expect(computeTierUnitPriceMinor("supporter", 1000, md)).toBe(1500)
  })

  it("multiplier override beats default when no absolute price is set", () => {
    const md = { sliding_scale_multipliers_bps: { solidarity: 5000 } }
    expect(computeTierUnitPriceMinor("solidarity", 1000, md)).toBe(500)
  })

  it("treats null metadata as 'no overrides'", () => {
    expect(computeTierUnitPriceMinor("supporter", 800, null)).toBe(1000)
  })
})
