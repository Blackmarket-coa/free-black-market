import {
  jaccard,
  scoreCreator,
  rankCreators,
  MATCHING_WEIGHTS,
  type CreatorSignal,
  type ProducerSignal,
} from "../_ranking"

describe("matching/_ranking", () => {
  describe("jaccard", () => {
    it("is 0 when either set is empty", () => {
      expect(jaccard([], ["compost"])).toBe(0)
      expect(jaccard(["compost"], [])).toBe(0)
    })

    it("is 1 for identical sets (case/space-insensitive)", () => {
      expect(jaccard(["Compost", " Soap "], ["soap", "compost"])).toBe(1)
    })

    it("computes partial overlap", () => {
      // {a,b} vs {b,c} -> inter 1, union 3
      expect(jaccard(["a", "b"], ["b", "c"])).toBeCloseTo(1 / 3, 5)
    })
  })

  describe("scoreCreator", () => {
    const producer: ProducerSignal = {
      categories: ["compost", "garden"],
      region: "SC",
    }

    it("rewards niche overlap, region match, reach and track record", () => {
      const creator: CreatorSignal = {
        creator_seller_id: "sel_a",
        niches: ["compost", "garden"],
        regions: ["sc"],
        follower_total: 1_000_000,
        attributed_cents: 100_000_000,
        clicks: 100_000,
      }
      const { score, reasons } = scoreCreator(producer, creator)
      // Perfect niche (0.4) + region (0.2) + ~full engagement (0.25) + ~full track (0.15)
      expect(score).toBeGreaterThan(0.9)
      expect(reasons.join(" ")).toMatch(/niche overlap/)
      expect(reasons.join(" ")).toMatch(/serves SC/)
    })

    it("scores a cold creator near zero", () => {
      const creator: CreatorSignal = {
        creator_seller_id: "sel_cold",
        niches: ["electronics"],
        regions: ["CA"],
        follower_total: 0,
        attributed_cents: 0,
        clicks: 0,
      }
      const { score } = scoreCreator(producer, creator)
      expect(score).toBe(0)
    })

    it("never exceeds the sum of weights", () => {
      const max =
        MATCHING_WEIGHTS.niche +
        MATCHING_WEIGHTS.region +
        MATCHING_WEIGHTS.engagement +
        MATCHING_WEIGHTS.trackRecord
      const creator: CreatorSignal = {
        creator_seller_id: "sel_max",
        niches: ["compost", "garden"],
        regions: ["sc"],
        follower_total: 10_000_000_000,
        attributed_cents: 10_000_000_000,
        clicks: 10_000_000,
      }
      expect(scoreCreator(producer, creator).score).toBeLessThanOrEqual(max)
    })
  })

  describe("rankCreators", () => {
    const producer: ProducerSignal = { categories: ["compost"], region: "SC" }

    const strong: CreatorSignal = {
      creator_seller_id: "sel_strong",
      niches: ["compost"],
      regions: ["sc"],
      follower_total: 500_000,
      attributed_cents: 5_000_000,
      clicks: 10_000,
    }
    const weak: CreatorSignal = {
      creator_seller_id: "sel_weak",
      niches: ["fashion"],
      regions: ["ny"],
      follower_total: 1_000,
      attributed_cents: 0,
      clicks: 5,
    }

    it("orders by descending score", () => {
      const ranked = rankCreators(producer, [weak, strong])
      expect(ranked[0].creator_seller_id).toBe("sel_strong")
      expect(ranked[1].creator_seller_id).toBe("sel_weak")
    })

    it("respects the limit", () => {
      const ranked = rankCreators(producer, [weak, strong], { limit: 1 })
      expect(ranked).toHaveLength(1)
      expect(ranked[0].creator_seller_id).toBe("sel_strong")
    })

    it("breaks ties deterministically by id", () => {
      const a: CreatorSignal = { ...weak, creator_seller_id: "sel_b" }
      const b: CreatorSignal = { ...weak, creator_seller_id: "sel_a" }
      const ranked = rankCreators(producer, [a, b])
      expect(ranked.map((r) => r.creator_seller_id)).toEqual(["sel_a", "sel_b"])
    })
  })
})
