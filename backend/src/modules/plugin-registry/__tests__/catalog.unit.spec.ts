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

// --- W3 addition: the Featured Vendor Widget seed manifest -----------------

import { buildFeaturedVendorWidgetManifest } from "../catalog"
import { ExtensionManifestSchema } from "../manifest"

describe("featured-vendor-widget seed (W3)", () => {
  it("ships a manifest that passes the shared extension schema", () => {
    const seed = PLUGIN_SEED.find((p) => p.slug === "featured-vendor-widget")
    expect(seed?.manifest).toBeDefined()
    const parsed = ExtensionManifestSchema.safeParse(seed!.manifest)
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.artifactKind).toBe("manifest_plugin")
      expect(parsed.data.version).toBe(seed!.version)
      expect(parsed.data.sha256).toMatch(/^[a-f0-9]{64}$/)
    }
  })

  it("builds deterministically (the declarative payload hash is stable)", () => {
    expect(buildFeaturedVendorWidgetManifest()).toEqual(buildFeaturedVendorWidgetManifest())
  })
})
