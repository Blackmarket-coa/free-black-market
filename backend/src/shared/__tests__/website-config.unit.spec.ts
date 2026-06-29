import {
  EMBED_FEATURE_KEYS,
  resolveEmbedFeatures,
  serializeWebsite,
} from "../website-config"

describe("resolveEmbedFeatures", () => {
  it("defaults to all surfaces on when null/undefined", () => {
    const fromNull = resolveEmbedFeatures(null)
    const fromUndefined = resolveEmbedFeatures(undefined)
    for (const key of EMBED_FEATURE_KEYS) {
      expect(fromNull[key]).toBe(true)
      expect(fromUndefined[key]).toBe(true)
    }
  })

  it("enables only the listed keys when a selection is stored", () => {
    const out = resolveEmbedFeatures(["products", "reviews"])
    expect(out.products).toBe(true)
    expect(out.reviews).toBe(true)
    expect(out.events).toBe(false)
    expect(out.chat).toBe(false)
    expect(out.vendor).toBe(false)
  })

  it("treats an empty array as everything off", () => {
    const out = resolveEmbedFeatures([])
    for (const key of EMBED_FEATURE_KEYS) {
      expect(out[key]).toBe(false)
    }
  })

  it("ignores unknown keys in the stored array", () => {
    const out = resolveEmbedFeatures(["products", "not_a_real_surface"] as string[])
    expect(out.products).toBe(true)
    expect(Object.keys(out).sort()).toEqual([...EMBED_FEATURE_KEYS].sort())
  })
})

describe("serializeWebsite embed_features", () => {
  it("exposes a resolved on/off map (default all on)", () => {
    const out = serializeWebsite("acme", {
      connect_domains: null,
      site_status: null,
      site_url: null,
      site_repo: null,
      embed_features: null,
    })
    expect(out.embed_features.products).toBe(true)
    expect(out.embed_features.chat).toBe(true)
  })

  it("reflects a custom selection", () => {
    const out = serializeWebsite("acme", {
      connect_domains: null,
      site_status: null,
      site_url: null,
      site_repo: null,
      embed_features: ["vendor", "products"],
    })
    expect(out.embed_features.vendor).toBe(true)
    expect(out.embed_features.products).toBe(true)
    expect(out.embed_features.events).toBe(false)
  })
})
