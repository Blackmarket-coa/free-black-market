import {
  computeOpportunityScore,
  normalizeDemand,
  normalizeCompetition,
  normalizeStartupCost,
  priceTrend,
  band,
  OPPORTUNITY_WEIGHTS,
} from "../_scoring"
import {
  startupCostDollarsForSubject,
  listStartupGuides,
  getStartupGuide,
} from "../startup-guides"

describe("opportunity-engine/_scoring", () => {
  describe("computeOpportunityScore", () => {
    it("rewards high demand + low competition + low startup cost (≈ spec 9.1)", () => {
      const { composite, bands } = computeOpportunityScore({
        demand: 0.95,
        competition: 0.1,
        startupCost: 0.1,
      })
      // 0.95*0.5 + 0.9*0.3 + 0.9*0.2 = 0.475 + 0.27 + 0.18 = 0.925 → 9.3
      expect(composite).toBeGreaterThanOrEqual(9)
      expect(composite).toBeLessThanOrEqual(10)
      expect(bands.demand).toBe("High")
      expect(bands.competition).toBe("Low")
    })

    it("punishes a crowded, expensive, low-demand subject", () => {
      const { composite } = computeOpportunityScore({
        demand: 0.05,
        competition: 0.95,
        startupCost: 0.95,
      })
      expect(composite).toBeLessThan(1.5)
    })

    it("never exceeds 10 or drops below 0", () => {
      expect(
        computeOpportunityScore({ demand: 10, competition: -5, startupCost: -1 })
          .composite
      ).toBeLessThanOrEqual(10)
      expect(
        computeOpportunityScore({ demand: -1, competition: 10, startupCost: 10 })
          .composite
      ).toBeGreaterThanOrEqual(0)
    })

    it("weights sum to 1 (a fully-ideal subject scores 10)", () => {
      const sum =
        OPPORTUNITY_WEIGHTS.demand +
        OPPORTUNITY_WEIGHTS.competition +
        OPPORTUNITY_WEIGHTS.startupCost
      expect(sum).toBeCloseTo(1, 6)
      expect(
        computeOpportunityScore({ demand: 1, competition: 0, startupCost: 0 })
          .composite
      ).toBe(10)
    })
  })

  describe("band", () => {
    it("buckets into Low/Medium/High", () => {
      expect(band(0.1)).toBe("Low")
      expect(band(0.5)).toBe("Medium")
      expect(band(0.8)).toBe("High")
    })
  })

  describe("normalizeDemand", () => {
    it("is 0 with no signal and rises with breadth/fill/money", () => {
      expect(
        normalizeDemand({
          openDemandPosts: 0,
          committedQuantity: 0,
          targetQuantity: 0,
          bountyDollars: 0,
          wishlistCount: 0,
          coalitionNeeds: 0,
        })
      ).toBe(0)

      const hot = normalizeDemand({
        openDemandPosts: 40,
        committedQuantity: 80,
        targetQuantity: 100,
        bountyDollars: 5000,
        wishlistCount: 30,
        coalitionNeeds: 10,
      })
      expect(hot).toBeGreaterThan(0.5)
      expect(hot).toBeLessThanOrEqual(1)
    })
  })

  describe("normalizeCompetition / normalizeStartupCost", () => {
    it("saturate toward 1 and floor at 0", () => {
      expect(normalizeCompetition({ activeSellers: 0, activeListings: 0 })).toBe(0)
      expect(
        normalizeCompetition({ activeSellers: 500, activeListings: 5000 })
      ).toBeGreaterThan(0.9)
      expect(normalizeStartupCost(0)).toBe(0)
      expect(normalizeStartupCost(100000)).toBeGreaterThan(0.9)
      // A cheap business reads as low startup cost.
      expect(normalizeStartupCost(350)).toBeLessThan(0.6)
    })
  })

  describe("priceTrend", () => {
    it("returns flat on empty input", () => {
      const t = priceTrend([])
      expect(t.direction).toBe("flat")
      expect(t.samples).toBe(0)
    })

    it("detects a rising series", () => {
      const t = priceTrend([
        { price_cents: 100, observed_at: "2026-01-01" },
        { price_cents: 110, observed_at: "2026-02-01" },
        { price_cents: 130, observed_at: "2026-03-01" },
      ])
      expect(t.direction).toBe("rising")
      expect(t.pctChange).toBeGreaterThan(0)
      expect(t.latestCents).toBe(130)
      expect(t.earliestCents).toBe(100)
    })

    it("detects a falling series", () => {
      const t = priceTrend([
        { price_cents: 200, observed_at: "2026-01-01" },
        { price_cents: 150, observed_at: "2026-02-01" },
        { price_cents: 120, observed_at: "2026-03-01" },
      ])
      expect(t.direction).toBe("falling")
      expect(t.pctChange).toBeLessThan(0)
    })

    it("is order-independent (sorts by time)", () => {
      const a = priceTrend([
        { price_cents: 130, observed_at: "2026-03-01" },
        { price_cents: 100, observed_at: "2026-01-01" },
        { price_cents: 110, observed_at: "2026-02-01" },
      ])
      expect(a.direction).toBe("rising")
    })
  })
})

describe("opportunity-engine/startup-guides (§12)", () => {
  it("exposes the four seed businesses with positive costs", () => {
    const guides = listStartupGuides()
    expect(guides.map((g) => g.id).sort()).toEqual([
      "compost",
      "gardening",
      "seedling",
      "soap",
    ])
    for (const g of guides) {
      expect(g.estimated_startup_cost_cents).toBeGreaterThan(0)
      expect(g.required_equipment.length).toBeGreaterThan(0)
      expect(g.production_suggestions.length).toBeGreaterThan(0)
      expect(g.related_opportunity_key).toBeTruthy()
    }
  })

  it("resolves a guide by slug or id", () => {
    expect(getStartupGuide("compost-business")?.id).toBe("compost")
    expect(getStartupGuide("compost")?.slug).toBe("compost-business")
    expect(getStartupGuide("nope")).toBeUndefined()
  })

  it("derives the cheapest startup cost for an opportunity subject", () => {
    // compost + gardening both map to agriculture; compost ($750) is cheaper.
    expect(startupCostDollarsForSubject("agriculture")).toBe(750)
    expect(startupCostDollarsForSubject("gardening")).toBe(350)
    expect(startupCostDollarsForSubject("unmapped")).toBeNull()
  })
})
