import {
  growerTierForXp,
  GROWER_TIERS,
  GROWER_KARMA_DELTAS,
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
