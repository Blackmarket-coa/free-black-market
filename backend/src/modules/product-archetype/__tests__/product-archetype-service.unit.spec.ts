import { ProductArchetypeCode } from "../models"

describe("ProductArchetype enum", () => {
  it("includes all marketplace-layer codes alongside the originals", () => {
    expect(ProductArchetypeCode.SERVICE).toBe("SERVICE")
    expect(ProductArchetypeCode.PLUGIN).toBe("PLUGIN")
    expect(ProductArchetypeCode.THEME).toBe("THEME")
    expect(ProductArchetypeCode.EMOJI_PACK).toBe("EMOJI_PACK")
    expect(ProductArchetypeCode.ACCESS_PASS).toBe("ACCESS_PASS")
    // sanity check on originals
    expect(ProductArchetypeCode.DIGITAL).toBe("DIGITAL")
    expect(ProductArchetypeCode.SUBSCRIPTION).toBe("SUBSCRIPTION")
  })
})
