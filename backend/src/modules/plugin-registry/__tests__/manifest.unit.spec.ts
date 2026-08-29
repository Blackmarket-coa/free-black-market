import {
  buildDistributionManifest,
  EXTENSION_ARTIFACT_KINDS,
  EXTENSION_CAPABILITIES,
  ExtensionManifestSchema,
  FBM_PROVIDER_ID,
  isExtensionListing,
  mapArtifactKindToCategory,
  resolvePluginSlug,
  validateExtensionManifest,
} from "../manifest"
import { PluginCategory } from "../models/plugin-listing"

const baseManifest = (over: Record<string, unknown> = {}) => ({
  id: "coop.fbm.sample-widget",
  name: "Sample Widget",
  version: "1.2.3",
  artifactKind: "manifest_plugin",
  capabilities: ["http.fetch"],
  description: "A sample",
  homepageCard: { title: "Sample", to: "/marketplace/sample", order: 10 },
  ...over,
})

describe("ExtensionManifestSchema", () => {
  it("accepts a well-formed authoring manifest and preserves unknown fields", () => {
    const parsed = ExtensionManifestSchema.safeParse(
      baseManifest({ fbm: { minHostVersion: "1.0.0", dataSource: { x: 1 } }, futureField: "kept" })
    )
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect((parsed.data as Record<string, unknown>).futureField).toBe("kept")
      expect((parsed.data.fbm as Record<string, unknown>).dataSource).toEqual({ x: 1 })
    }
  })

  it("rejects bad ids, versions, kinds, capabilities and bounds", () => {
    const bad = [
      baseManifest({ id: "!" }),
      baseManifest({ version: "not-semver" }),
      baseManifest({ artifactKind: "nonsense" }),
      baseManifest({ capabilities: ["root.everything"] }),
      baseManifest({ fbm: { minHostVersion: "garbage" } }),
      baseManifest({ sha256: "zz" }),
    ]
    for (const input of bad) {
      expect(ExtensionManifestSchema.safeParse(input).success).toBe(false)
    }
  })

  it("mirrors the blackout protocol literal counts (14 kinds, 10 capabilities)", () => {
    expect(EXTENSION_ARTIFACT_KINDS).toHaveLength(14)
    expect(EXTENSION_CAPABILITIES).toHaveLength(10)
    expect(EXTENSION_ARTIFACT_KINDS).toContain("manifest_plugin")
    expect(EXTENSION_ARTIFACT_KINDS).toContain("twitch_extension_compat")
    expect(EXTENSION_CAPABILITIES).toContain("twitch.ext.subscriptionStatus")
  })
})

describe("isExtensionListing", () => {
  it("marks listings by plugin_slug or manifest.artifactKind and nothing else", () => {
    expect(isExtensionListing({ plugin_slug: "sample-widget" })).toBe(true)
    expect(isExtensionListing({ manifest: { artifactKind: "theme" } })).toBe(true)
    expect(isExtensionListing({ plugin_slug: "", manifest: { foo: "bar" } })).toBe(false)
    expect(isExtensionListing({ manifest: { artifactKind: null } })).toBe(false)
    expect(isExtensionListing({})).toBe(false)
    expect(isExtensionListing({ manifest: "not-an-object" })).toBe(false)
  })
})

describe("validateExtensionManifest", () => {
  it("authoring mode accepts a valid manifest and reports schema errors with paths", () => {
    expect(validateExtensionManifest(baseManifest()).ok).toBe(true)
    const bad = validateExtensionManifest(baseManifest({ version: "x" }))
    expect(bad.ok).toBe(false)
    if (!bad.ok) {
      expect(bad.errors.some((e) => e.startsWith("version:"))).toBe(true)
    }
  })

  it("publish mode binds the manifest version to the listing version", () => {
    const result = validateExtensionManifest(baseManifest(), {
      forPublish: true,
      listingVersion: "9.9.9",
      listingSlug: "sample-widget",
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("must equal the listing version"))).toBe(true)
    }
  })

  it("publish mode requires sha256 for code_plugin but not manifest_plugin", () => {
    const codePlugin = validateExtensionManifest(
      baseManifest({ artifactKind: "code_plugin", entry: "index.js" }),
      { forPublish: true, listingVersion: "1.2.3", listingSlug: "sample-widget" }
    )
    expect(codePlugin.ok).toBe(false)
    if (!codePlugin.ok) {
      expect(codePlugin.errors.some((e) => e.startsWith("sha256:"))).toBe(true)
    }
    const manifestPlugin = validateExtensionManifest(baseManifest(), {
      forPublish: true,
      listingVersion: "1.2.3",
      listingSlug: "sample-widget",
    })
    expect(manifestPlugin.ok).toBe(true)
  })

  it("publish mode requires a resolvable, valid plugin slug", () => {
    const noSlug = validateExtensionManifest(baseManifest(), {
      forPublish: true,
      listingVersion: "1.2.3",
    })
    expect(noSlug.ok).toBe(false)
    const badSlug = validateExtensionManifest(baseManifest(), {
      forPublish: true,
      listingVersion: "1.2.3",
      pluginSlug: "Bad Slug!",
    })
    expect(badSlug.ok).toBe(false)
  })
})

describe("resolvePluginSlug", () => {
  it("prefers the explicit plugin_slug, then the listing slug", () => {
    expect(resolvePluginSlug({ pluginSlug: "explicit", listingSlug: "listing" })).toBe("explicit")
    expect(resolvePluginSlug({ listingSlug: "listing" })).toBe("listing")
    expect(resolvePluginSlug({})).toBeNull()
  })
})

describe("buildDistributionManifest", () => {
  it("injects the listing ref, defaults protocolVersion 2, and binds the bundle hash", () => {
    const authored = ExtensionManifestSchema.parse(baseManifest())
    const dist = buildDistributionManifest({
      authored,
      listingId: "cl_123",
      publicSlug: "sample-widget",
      codeSha256: "a".repeat(64),
    })
    expect(dist.listing).toEqual({
      providerId: FBM_PROVIDER_ID,
      providerListingId: "cl_123",
      publicSlug: "sample-widget",
    })
    expect(dist.protocolVersion).toBe(2)
    expect(dist.sha256).toBe("a".repeat(64))
    // Deterministic: same inputs, same output.
    expect(
      buildDistributionManifest({
        authored,
        listingId: "cl_123",
        publicSlug: "sample-widget",
        codeSha256: "a".repeat(64),
      })
    ).toEqual(dist)
  })

  it("falls back to the authored sha256 (manifest_plugin declarative payload hash)", () => {
    const authored = ExtensionManifestSchema.parse(baseManifest({ sha256: "b".repeat(64) }))
    const dist = buildDistributionManifest({
      authored,
      listingId: "cl_9",
      publicSlug: "sample-widget",
      codeSha256: null,
    })
    expect(dist.sha256).toBe("b".repeat(64))
  })
})

describe("mapArtifactKindToCategory", () => {
  it("maps automation recipes to AUTOMATION, honors fbm override, defaults to MARKETPLACE_EXTENSION", () => {
    expect(mapArtifactKindToCategory("automation_recipe")).toBe(PluginCategory.AUTOMATION)
    expect(mapArtifactKindToCategory("theme")).toBe(PluginCategory.MARKETPLACE_EXTENSION)
    expect(mapArtifactKindToCategory("theme", PluginCategory.ANALYTICS)).toBe(
      PluginCategory.ANALYTICS
    )
  })
})
