import { KB_SEED_ARTICLES, filterArticles } from "../catalog"

describe("knowledge-base/catalog (§14)", () => {
  it("seeds the DIY library, container gardening, and substitution guides", () => {
    const slugs = KB_SEED_ARTICLES.map((a) => a.slug)
    // The four named DIY library entries from the spec.
    expect(slugs).toEqual(
      expect.arrayContaining([
        "diy-laundry-detergent",
        "diy-compost-at-home",
        "diy-seed-starting",
        "diy-food-preservation",
      ])
    )
    const types = new Set(KB_SEED_ARTICLES.map((a) => a.type))
    expect(types).toEqual(
      new Set(["DIY", "CONTAINER_GARDENING", "SUBSTITUTION"])
    )
  })

  it("every article has materials and steps", () => {
    for (const a of KB_SEED_ARTICLES) {
      expect(a.materials.length).toBeGreaterThan(0)
      expect(a.steps.length).toBeGreaterThan(0)
      expect(a.slug).toMatch(/^[a-z0-9-]+$/)
    }
  })

  it("slugs are unique", () => {
    const slugs = KB_SEED_ARTICLES.map((a) => a.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  describe("filterArticles", () => {
    it("filters by type", () => {
      const diy = filterArticles(KB_SEED_ARTICLES, { type: "DIY" })
      expect(diy.length).toBeGreaterThanOrEqual(4)
      expect(diy.every((a) => a.type === "DIY")).toBe(true)
    })

    it("filters container guides by climate zone and space", () => {
      const cool = filterArticles(KB_SEED_ARTICLES, {
        type: "CONTAINER_GARDENING",
        climate_zone: "cool",
      })
      expect(cool).toHaveLength(1)
      expect(cool[0].slug).toBe("container-gardening-cool-balcony")
    })

    it("matches free-text q against title and summary", () => {
      const compost = filterArticles(KB_SEED_ARTICLES, { q: "compost" })
      expect(compost.some((a) => a.slug === "diy-compost-at-home")).toBe(true)
    })

    it("returns all when no filter is given", () => {
      expect(filterArticles(KB_SEED_ARTICLES, {})).toHaveLength(
        KB_SEED_ARTICLES.length
      )
    })
  })
})
