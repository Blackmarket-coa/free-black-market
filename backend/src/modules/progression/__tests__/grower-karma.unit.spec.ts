import {
  growerTierForXp,
  GROWER_TIERS,
  GROWER_KARMA_DELTAS,
  effectiveGrowerTier,
  asGrowerTierName,
  growerTierIndex,
} from "../grower-karma"

describe("grower-karma: growerTierForXp", () => {
  it("maps XP to the correct tier at boundaries", () => {
    expect(growerTierForXp(0)).toBe("Seedling")
    expect(growerTierForXp(49)).toBe("Seedling")
    expect(growerTierForXp(50)).toBe("Sprout")
    expect(growerTierForXp(199)).toBe("Sprout")
    expect(growerTierForXp(200)).toBe("Root")
    expect(growerTierForXp(499)).toBe("Root")
    expect(growerTierForXp(500)).toBe("Canopy")
    expect(growerTierForXp(1499)).toBe("Canopy")
    expect(growerTierForXp(1500)).toBe("Ancestor")
    expect(growerTierForXp(99999)).toBe("Ancestor")
  })

  it("never returns below Seedling for negative XP", () => {
    expect(growerTierForXp(-10)).toBe("Seedling")
  })

  it("tier split percentages increase monotonically", () => {
    const order = ["Seedling", "Sprout", "Root", "Canopy", "Ancestor"] as const
    for (let i = 1; i < order.length; i++) {
      expect(GROWER_TIERS[order[i]].split_pct).toBeGreaterThan(
        GROWER_TIERS[order[i - 1]].split_pct
      )
    }
  })

  it("defines the expected KARMA deltas", () => {
    expect(GROWER_KARMA_DELTAS.units_sold).toBe(1)
    expect(GROWER_KARMA_DELTAS.rare_species_produced).toBe(10)
    expect(GROWER_KARMA_DELTAS.five_star_review).toBe(15)
    expect(GROWER_KARMA_DELTAS.seasonal_deadline_met).toBe(20)
  })
})

describe("grower-karma: asGrowerTierName", () => {
  it("accepts real tier names", () => {
    expect(asGrowerTierName("Root")).toBe("Root")
    expect(asGrowerTierName("Ancestor")).toBe("Ancestor")
  })

  it("rejects anything that is not a tier name", () => {
    expect(asGrowerTierName("root")).toBeNull() // case-sensitive
    expect(asGrowerTierName("Platinum")).toBeNull()
    expect(asGrowerTierName("")).toBeNull()
    expect(asGrowerTierName(null)).toBeNull()
    expect(asGrowerTierName(undefined)).toBeNull()
  })
})

describe("grower-karma: effectiveGrowerTier (earned-vs-bought)", () => {
  it("uses the earned tier when the plan makes no floor claim", () => {
    expect(effectiveGrowerTier(500, null)).toEqual({
      tier: "Canopy",
      floored_by_plan: false,
    })
    expect(effectiveGrowerTier(0, undefined)).toEqual({
      tier: "Seedling",
      floored_by_plan: false,
    })
  })

  it("raises a grower to the plan floor when it beats their earned tier", () => {
    // Earned Seedling (10 XP), plan floors to Root: bought wins.
    expect(effectiveGrowerTier(10, "Root")).toEqual({
      tier: "Root",
      floored_by_plan: true,
    })
  })

  it("keeps an earned tier that already exceeds the plan floor", () => {
    // Earned Ancestor (2000 XP) on a plan that only floors to Root: earned wins,
    // and it is not reported as plan-floored.
    expect(effectiveGrowerTier(2000, "Root")).toEqual({
      tier: "Ancestor",
      floored_by_plan: false,
    })
  })

  it("does not report a floor equal to the earned tier as plan-floored", () => {
    // Earned Root (200 XP), plan floors to Root: no lift, so earned is credited.
    expect(effectiveGrowerTier(200, "Root")).toEqual({
      tier: "Root",
      floored_by_plan: false,
    })
  })

  it("ignores an unrecognized floor and falls back to earned", () => {
    expect(effectiveGrowerTier(10, "Platinum")).toEqual({
      tier: "Seedling",
      floored_by_plan: false,
    })
  })

  it("orders tiers by ladder position", () => {
    expect(growerTierIndex("Seedling")).toBe(0)
    expect(growerTierIndex("Ancestor")).toBe(4)
  })
})
