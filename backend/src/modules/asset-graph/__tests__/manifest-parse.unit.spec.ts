import {
  PROJECT_MANIFESTS,
  MANIFEST_SLUGS,
  getManifest,
  ProjectManifestSchema,
} from "../manifests"
import {
  ASSET_KIND_CATALOG,
  getAssetKind,
  matchesKindSlug,
} from "../seed/asset-kinds"
import { PLAYBOOK_RECIPES } from "../../playbook/recipes"
import type { PlaybookId } from "../../playbook/recipes"
import { LISTING_TYPE_IDS } from "../../listing-type/catalog"
import type { ListingTypeId } from "../../listing-type/catalog"

describe("project manifest catalog", () => {
  it("registers the v0 manifests", () => {
    expect(MANIFEST_SLUGS).toEqual(
      expect.arrayContaining(["yard-scrap-nursery", "tool-library"])
    )
    expect(MANIFEST_SLUGS).toHaveLength(2)
  })

  it("every manifest re-parses cleanly through the zod schema (no escape hatches)", () => {
    for (const slug of MANIFEST_SLUGS) {
      const m = PROJECT_MANIFESTS[slug]
      expect(() => ProjectManifestSchema.parse(m)).not.toThrow()
    }
  })

  it("every manifest's playbook_slug resolves in the playbook catalog", () => {
    for (const slug of MANIFEST_SLUGS) {
      const m = PROJECT_MANIFESTS[slug]
      expect(PLAYBOOK_RECIPES[m.playbook_slug as PlaybookId]).toBeDefined()
    }
  })

  it("every manifest's listing-types are subset of the playbook's allowed types", () => {
    for (const slug of MANIFEST_SLUGS) {
      const m = PROJECT_MANIFESTS[slug]
      const allowed = PLAYBOOK_RECIPES[m.playbook_slug as PlaybookId]
        .allowed_listing_types as string[]
      for (const lt of m.listing_type_slugs) {
        expect(allowed).toContain(lt as string)
      }
    }
  })

  it("every manifest's listing-types are valid catalog entries", () => {
    for (const slug of MANIFEST_SLUGS) {
      for (const lt of PROJECT_MANIFESTS[slug].listing_type_slugs) {
        expect(LISTING_TYPE_IDS).toContain(lt as ListingTypeId)
      }
    }
  })

  it("every required asset kind resolves in the asset-kind catalog (or is a wildcard whose prefix does)", () => {
    for (const slug of MANIFEST_SLUGS) {
      for (const req of PROJECT_MANIFESTS[slug].required_asset_kinds) {
        if (req.kind_slug.endsWith(".*")) {
          const prefix = req.kind_slug.slice(0, -2)
          expect(() => getAssetKind(prefix)).not.toThrow()
        } else {
          expect(() => getAssetKind(req.kind_slug)).not.toThrow()
        }
      }
    }
  })

  it("getManifest throws on unknown slug", () => {
    expect(() => getManifest("nonexistent" as any)).toThrow()
  })

  it("schema rejects an invalid settlement rail", () => {
    expect(() =>
      ProjectManifestSchema.parse({
        slug: "bad",
        version: "0.0.1",
        display_name: "bad",
        description: "bad",
        required_asset_kinds: [{ kind_slug: "tool.*", role: "lender" }],
        settlement_rails: ["bitcoin"],
        playbook_slug: "commons",
        listing_type_slugs: ["bookable"],
        governance_model: "collective",
        sensitivity_floor: "public",
        surface: "threshold",
      })
    ).toThrow()
  })

  it("schema rejects a malformed slug", () => {
    expect(() =>
      ProjectManifestSchema.parse({
        slug: "Bad_Slug",
        version: "0.0.1",
        display_name: "bad",
        description: "bad",
        required_asset_kinds: [{ kind_slug: "tool.*", role: "lender" }],
        settlement_rails: ["ccr"],
        playbook_slug: "commons",
        listing_type_slugs: ["bookable"],
        governance_model: "collective",
        sensitivity_floor: "public",
        surface: "threshold",
      })
    ).toThrow()
  })
})

describe("asset kind catalog", () => {
  it("seeds at least the kinds the v0 manifests reference", () => {
    expect(ASSET_KIND_CATALOG.length).toBeGreaterThanOrEqual(25)
  })

  it("every kind's parent_slug resolves to another kind (or is null)", () => {
    const slugs = new Set(ASSET_KIND_CATALOG.map((k) => k.slug))
    for (const k of ASSET_KIND_CATALOG) {
      if (k.parent_slug !== null) {
        expect(slugs.has(k.parent_slug)).toBe(true)
      }
    }
  })
})

describe("wildcard kind matcher", () => {
  it("matches exact slugs", () => {
    expect(matchesKindSlug("tool.vehicle.truck", "tool.vehicle.truck")).toBe(
      true
    )
  })

  it("does not match different exact slugs", () => {
    expect(matchesKindSlug("tool.vehicle.truck", "tool.vehicle")).toBe(false)
  })

  it("matches a wildcard against its prefix", () => {
    expect(matchesKindSlug("tool.*", "tool")).toBe(true)
  })

  it("matches a wildcard against any subkind", () => {
    expect(matchesKindSlug("tool.*", "tool.power-tool")).toBe(true)
    expect(matchesKindSlug("tool.*", "tool.vehicle.truck")).toBe(true)
  })

  it("does not match a wildcard against an unrelated kind", () => {
    expect(matchesKindSlug("tool.*", "skill.horticulture")).toBe(false)
  })
})
