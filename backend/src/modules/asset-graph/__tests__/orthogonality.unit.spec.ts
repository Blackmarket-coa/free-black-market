/**
 * Orthogonality test.
 *
 * The v0 thesis: if the asset-graph schema fits the yard-scrap nursery,
 * the tool library, and the repair café without warping, it is likely
 * to fit care-economy and mobility-commons manifests later without a
 * major rework. This file is that thesis as code.
 *
 * The test runs in two modes.
 *
 *   1. Pairwise structural diversity. For every pair of manifests in
 *      the catalog:
 *        - required asset-kind slug sets are not identical, and each
 *          side contributes at least two slugs the other does not
 *          (the original "no overlap at all" rule held for two
 *          manifests but is wrong in general — multiple manifests can
 *          legitimately both need a coordinator, a venue, etc.;
 *          orthogonality at N≥3 means substantial difference, not
 *          total disjointness),
 *        - settlement-rail sets are not identical (a manifest may be a
 *          subset, e.g. repair café's {karma, gift} ⊂ tool library's
 *          {hours, karma, ccr, gift} — equality is what would prove the
 *          rail axis is not load-bearing),
 *        - at least one of (playbook, governance, surface) differs,
 *        - the pair exercises at least one lifecycle value the other
 *          does not (preserves the original v0 lifecycle-pressure axis).
 *
 *   2. Catalog-wide coverage. As manifests are added, the catalog must
 *      keep covering more of each enum:
 *        - every value in the Lifecycle enum is exercised by some
 *          manifest,
 *        - every value in the SettlementRail enum is exercised by some
 *          manifest,
 *        - the catalog reaches at least three distinct playbooks, three
 *          distinct governance models, and two distinct surfaces,
 *        - at least two manifests use the trailing-`.*` wildcard on
 *          distinct category roots (proves the matcher is not
 *          load-bearing on a single category).
 *
 * If a future change collapses these axes, this test fails and the
 * question becomes either "is the change still structurally honest?"
 * or "do we need another orthogonal manifest?".
 */

import {
  YARD_SCRAP_NURSERY_MANIFEST as NURSERY,
} from "../manifests/yard-scrap-nursery"
import { TOOL_LIBRARY_MANIFEST as TOOLS } from "../manifests/tool-library"
import { REPAIR_CAFE_MANIFEST as REPAIR } from "../manifests/repair-cafe"
import { PROJECT_MANIFESTS, MANIFEST_SLUGS } from "../manifests"
import type { ProjectManifestRecipe } from "../manifests/types"

type Req = {
  kind_slug: string
  lifecycle?: string
  role?: string
  min_count?: number
  optional?: boolean
}

const allManifests = (): ProjectManifestRecipe[] =>
  MANIFEST_SLUGS.map((s) => PROJECT_MANIFESTS[s])

const pairs = (): Array<[ProjectManifestRecipe, ProjectManifestRecipe]> => {
  const all = allManifests()
  const out: Array<[ProjectManifestRecipe, ProjectManifestRecipe]> = []
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      out.push([all[i], all[j]])
    }
  }
  return out
}

const lifecyclesOf = (m: ProjectManifestRecipe): Set<string> =>
  new Set(
    (m.required_asset_kinds as Req[])
      .map((r: Req) => r.lifecycle)
      .filter((l): l is string => typeof l === "string")
  )

describe("v0 manifest orthogonality — pairwise", () => {
  it("required asset kind slug sets are not identical, and each pair differs by at least two slugs on each side", () => {
    for (const [a, b] of pairs()) {
      const slugsA = new Set<string>(
        (a.required_asset_kinds as Req[]).map((r: Req) => r.kind_slug)
      )
      const slugsB = new Set<string>(
        (b.required_asset_kinds as Req[]).map((r: Req) => r.kind_slug)
      )
      const aOnly = [...slugsA].filter((s) => !slugsB.has(s))
      const bOnly = [...slugsB].filter((s) => !slugsA.has(s))
      expect({
        pair: [a.slug, b.slug],
        identical_kind_sets: aOnly.length === 0 && bOnly.length === 0,
      }).toEqual({
        pair: [a.slug, b.slug],
        identical_kind_sets: false,
      })
      expect({
        pair: [a.slug, b.slug],
        a_unique: aOnly.length,
        b_unique: bOnly.length,
      }).toEqual({
        pair: [a.slug, b.slug],
        a_unique: expect.any(Number),
        b_unique: expect.any(Number),
      })
      expect(aOnly.length).toBeGreaterThanOrEqual(2)
      expect(bOnly.length).toBeGreaterThanOrEqual(2)
    }
  })

  it("at least one manifest declares a kind slug no other manifest in the catalog uses", () => {
    const all = allManifests()
    const ownedBy = new Map<string, Set<string>>()
    for (const m of all) {
      for (const r of m.required_asset_kinds as Req[]) {
        if (!ownedBy.has(r.kind_slug)) ownedBy.set(r.kind_slug, new Set())
        ownedBy.get(r.kind_slug)!.add(m.slug)
      }
    }
    const manifestsWithExclusiveKind = new Set<string>()
    for (const [, owners] of ownedBy) {
      if (owners.size === 1) {
        for (const o of owners) manifestsWithExclusiveKind.add(o)
      }
    }
    expect(manifestsWithExclusiveKind.size).toBeGreaterThanOrEqual(1)
  })

  it("settlement rail sets are not identical between any pair", () => {
    for (const [a, b] of pairs()) {
      const sa = [...new Set<string>(a.settlement_rails)].sort()
      const sb = [...new Set<string>(b.settlement_rails)].sort()
      expect({ pair: [a.slug, b.slug], sa, sb }).not.toEqual({
        pair: [a.slug, b.slug],
        sa,
        sb: sa,
      })
    }
  })

  it("at least one of (playbook, governance, surface) differs between any pair", () => {
    for (const [a, b] of pairs()) {
      const same =
        a.playbook_slug === b.playbook_slug &&
        a.governance_model === b.governance_model &&
        a.surface === b.surface
      expect({ pair: [a.slug, b.slug], same }).toEqual({
        pair: [a.slug, b.slug],
        same: false,
      })
    }
  })

  it("every pair exercises at least one lifecycle value the other does not", () => {
    for (const [a, b] of pairs()) {
      const la = lifecyclesOf(a)
      const lb = lifecyclesOf(b)
      const aOnly = [...la].filter((l) => !lb.has(l))
      const bOnly = [...lb].filter((l) => !la.has(l))
      expect({
        pair: [a.slug, b.slug],
        symmetric_difference: aOnly.length + bOnly.length,
      }).toEqual({
        pair: [a.slug, b.slug],
        symmetric_difference: expect.any(Number),
      })
      expect(aOnly.length + bOnly.length).toBeGreaterThan(0)
    }
  })
})

describe("v0 manifest orthogonality — catalog coverage", () => {
  it("the catalog covers every Lifecycle enum value", () => {
    const seen = new Set<string>()
    for (const m of allManifests()) {
      for (const l of lifecyclesOf(m)) seen.add(l)
    }
    const expected = [
      "one-time",
      "recurring",
      "durable-commitment",
      "perishable",
      "exhaustible-borrow-return",
    ]
    for (const l of expected) expect(seen.has(l)).toBe(true)
  })

  it("the catalog covers every SettlementRail enum value", () => {
    const seen = new Set<string>()
    for (const m of allManifests()) {
      for (const r of m.settlement_rails) seen.add(r)
    }
    const expected = ["ccr", "usdc", "usd", "karma", "hours", "gift"]
    for (const r of expected) expect(seen.has(r)).toBe(true)
  })

  it("the catalog covers at least three distinct playbooks", () => {
    const playbooks = new Set(allManifests().map((m) => m.playbook_slug))
    expect(playbooks.size).toBeGreaterThanOrEqual(3)
  })

  it("the catalog covers at least three distinct governance models", () => {
    const govs = new Set(allManifests().map((m) => m.governance_model))
    expect(govs.size).toBeGreaterThanOrEqual(3)
  })

  it("the catalog covers at least two distinct surfaces", () => {
    const surfaces = new Set(allManifests().map((m) => m.surface))
    expect(surfaces.size).toBeGreaterThanOrEqual(2)
  })

  it("at least two manifests use the trailing-'.*' wildcard on distinct category roots", () => {
    const roots = new Set<string>()
    for (const m of allManifests()) {
      for (const r of m.required_asset_kinds as Req[]) {
        if (r.kind_slug.endsWith(".*")) {
          roots.add(r.kind_slug.slice(0, -2).split(".")[0])
        }
      }
    }
    expect(roots.size).toBeGreaterThanOrEqual(2)
  })
})

describe("v0 manifest orthogonality — per-manifest invariants", () => {
  it("nursery uses grove + commerce + individual + no wildcards", () => {
    expect(NURSERY.playbook_slug).toBe("grove")
    expect(NURSERY.surface).toBe("commerce")
    expect(NURSERY.governance_model).toBe("individual")
    const wildcards = (NURSERY.required_asset_kinds as Req[]).filter((r: Req) =>
      r.kind_slug.endsWith(".*")
    )
    expect(wildcards).toEqual([])
  })

  it("tool library uses commons + threshold + collective + tool.* wildcard + exhaustible-borrow-return", () => {
    expect(TOOLS.playbook_slug).toBe("commons")
    expect(TOOLS.surface).toBe("threshold")
    expect(TOOLS.governance_model).toBe("collective")
    const toolWildcards = (TOOLS.required_asset_kinds as Req[]).filter(
      (r: Req) => r.kind_slug === "tool.*"
    )
    expect(toolWildcards.length).toBeGreaterThan(0)
    expect(lifecyclesOf(TOOLS).has("exhaustible-borrow-return")).toBe(true)
  })

  it("repair café uses workshop + threshold + consensus + skill.repair.* wildcard + perishable + one-time + public floor", () => {
    expect(REPAIR.playbook_slug).toBe("workshop")
    expect(REPAIR.surface).toBe("threshold")
    expect(REPAIR.governance_model).toBe("consensus")
    expect(REPAIR.sensitivity_floor).toBe("public")
    const skillWildcards = (REPAIR.required_asset_kinds as Req[]).filter(
      (r: Req) => r.kind_slug === "skill.repair.*"
    )
    expect(skillWildcards.length).toBeGreaterThan(0)
    const cycles = lifecyclesOf(REPAIR)
    expect(cycles.has("perishable")).toBe(true)
    expect(cycles.has("one-time")).toBe(true)
  })
})
