import { PLUGIN_SEED } from "../catalog"

describe("plugin-registry/catalog (§16)", () => {
  it("covers all three plugin categories", () => {
    const categories = new Set(PLUGIN_SEED.map((p) => p.category))
    expect(categories).toEqual(
      new Set(["MARKETPLACE_EXTENSION", "ANALYTICS", "AUTOMATION"])
    )
  })

  it("has unique, well-formed slugs and versions", () => {
    const slugs = PLUGIN_SEED.map((p) => p.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
    for (const p of PLUGIN_SEED) {
      expect(p.slug).toMatch(/^[a-z0-9-]+$/)
      expect(p.version).toMatch(/^\d+\.\d+\.\d+$/)
      expect(p.name.length).toBeGreaterThan(0)
      expect(p.description.length).toBeGreaterThan(0)
    }
  })
})
