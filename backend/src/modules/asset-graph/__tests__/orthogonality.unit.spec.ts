/**
 * Orthogonality test.
 *
 * The v0 thesis: if the asset-graph schema fits both the yard-scrap
 * nursery and the tool library without warping, it is likely to fit
 * care-economy and mobility-commons manifests later without a major
 * rework. This file is that thesis as code.
 *
 * The two manifests must:
 *   - share zero required-asset-kind slugs,
 *   - use disjoint settlement-rail sets,
 *   - exercise different lifecycle types,
 *   - declare different governance models,
 *   - land on different composition surfaces,
 *   - and select different playbook recipes.
 *
 * If a future change makes them overlap on any of these axes, this
 * test fails and the question becomes either "is the change still
 * orthogonality-respecting?" or "do we need a third orthogonal
 * manifest?".
 */

import {
  YARD_SCRAP_NURSERY_MANIFEST as NURSERY,
} from "../manifests/yard-scrap-nursery"
import { TOOL_LIBRARY_MANIFEST as TOOLS } from "../manifests/tool-library"
import type { ProjectManifestRecipe } from "../manifests/types"

/** Concrete shape used by orthogonality assertions; mirrors the zod schema. */
type Req = {
  kind_slug: string
  lifecycle?: string
  role?: string
  min_count?: number
  optional?: boolean
}

describe("v0 manifest orthogonality", () => {
  it("required asset kind slugs do not overlap", () => {
    const a = new Set<string>(
      (NURSERY.required_asset_kinds as Req[]).map((r: Req) => r.kind_slug)
    )
    const b = new Set<string>(
      (TOOLS.required_asset_kinds as Req[]).map((r: Req) => r.kind_slug)
    )
    const overlap = [...a].filter((s: string) => b.has(s))
    expect(overlap).toEqual([])
  })

  it("settlement rails are disjoint", () => {
    const a = new Set<string>(NURSERY.settlement_rails)
    const b = new Set<string>(TOOLS.settlement_rails)
    // 'gift' is the one rail allowed to be shared because every vertical
    // can fall back to a non-settling exchange; the rest must be
    // disjoint to prove the rail abstraction generalizes.
    const overlap = [...a].filter((s: string) => b.has(s) && s !== "gift")
    expect(overlap).toEqual([])
  })

  it("lifecycles exercised are not identical between the two manifests", () => {
    const lifecycles = (m: ProjectManifestRecipe): Set<string> =>
      new Set(
        (m.required_asset_kinds as Req[])
          .map((r: Req) => r.lifecycle)
          .filter((l): l is string => typeof l === "string")
      )
    const a = lifecycles(NURSERY)
    const b = lifecycles(TOOLS)
    // Tool library must touch a lifecycle the nursery does not.
    const toolsOnly = [...b].filter((l: string) => !a.has(l))
    expect(toolsOnly.length).toBeGreaterThan(0)
    expect(b.has("exhaustible-borrow-return")).toBe(true)
    expect(a.has("exhaustible-borrow-return")).toBe(false)
  })

  it("governance models differ", () => {
    expect(NURSERY.governance_model).not.toBe(TOOLS.governance_model)
    expect(NURSERY.governance_model).toBe("individual")
    expect(TOOLS.governance_model).toBe("collective")
  })

  it("surfaces differ", () => {
    expect(NURSERY.surface).not.toBe(TOOLS.surface)
    expect(NURSERY.surface).toBe("commerce")
    expect(TOOLS.surface).toBe("threshold")
  })

  it("playbook recipes differ", () => {
    expect(NURSERY.playbook_slug).not.toBe(TOOLS.playbook_slug)
    expect(NURSERY.playbook_slug).toBe("grove")
    expect(TOOLS.playbook_slug).toBe("commons")
  })

  it("tool library uses the wildcard kind matcher (taxonomy hierarchy is load-bearing)", () => {
    const wildcards = (TOOLS.required_asset_kinds as Req[]).filter(
      (r: Req) => r.kind_slug.endsWith(".*")
    )
    expect(wildcards.length).toBeGreaterThan(0)
  })

  it("nursery does not use wildcards (its asset kinds are concrete leaves)", () => {
    const wildcards = (NURSERY.required_asset_kinds as Req[]).filter(
      (r: Req) => r.kind_slug.endsWith(".*")
    )
    expect(wildcards).toEqual([])
  })
})
