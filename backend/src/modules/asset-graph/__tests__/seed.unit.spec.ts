/**
 * Seeder behavior tests.
 *
 * Verifies that `seed-asset-graph.ts`:
 *   - upserts every entry in ASSET_KIND_CATALOG and PROJECT_MANIFESTS,
 *   - calls create on a fresh DB and update on a populated DB
 *     (idempotency: re-running produces no duplicates),
 *   - encodes the catalog faithfully (slug, category, parent_slug,
 *     default lifecycle/sensitivity are preserved verbatim from the
 *     in-code source of truth).
 *
 * The seeder is a thin loop over the in-memory catalog; the test
 * stands in a fake service that records every method call and asserts
 * what was sent.
 */

import seedAssetGraph from "../../../scripts/seed-asset-graph"
import { ASSET_KIND_CATALOG } from "../seed/asset-kinds"
import { PROJECT_MANIFESTS, MANIFEST_SLUGS } from "../manifests"
import { ASSET_GRAPH_MODULE } from "../"

type Call = { method: string; args: any }

const makeFakeService = (
  opts: { withExistingKinds?: boolean; withExistingManifests?: boolean } = {}
) => {
  const calls: Call[] = []
  const fakeKindRow = (slug: string) => ({ id: `ak_${slug}`, slug })
  const fakeManifestRow = (slug: string) => ({ id: `pm_${slug}`, slug })

  return {
    calls,
    listAssetKinds: jest.fn(async (filter: { slug?: string }) => {
      calls.push({ method: "listAssetKinds", args: filter })
      if (opts.withExistingKinds && filter.slug) {
        return [fakeKindRow(filter.slug)]
      }
      return []
    }),
    createAssetKinds: jest.fn(async (payload: any) => {
      calls.push({ method: "createAssetKinds", args: payload })
      return fakeKindRow(payload.slug)
    }),
    updateAssetKinds: jest.fn(async (payload: any) => {
      calls.push({ method: "updateAssetKinds", args: payload })
      return payload
    }),
    listProjectManifests: jest.fn(async (filter: { slug?: string }) => {
      calls.push({ method: "listProjectManifests", args: filter })
      if (opts.withExistingManifests && filter.slug) {
        return [fakeManifestRow(filter.slug)]
      }
      return []
    }),
    createProjectManifests: jest.fn(async (payload: any) => {
      calls.push({ method: "createProjectManifests", args: payload })
      return fakeManifestRow(payload.slug)
    }),
    updateProjectManifests: jest.fn(async (payload: any) => {
      calls.push({ method: "updateProjectManifests", args: payload })
      return payload
    }),
  }
}

const makeContainer = (service: any) => ({
  resolve: (key: string) => {
    if (key === ASSET_GRAPH_MODULE) return service
    // Logger swallows everything in tests.
    return {
      info: () => undefined,
      debug: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    }
  },
})

describe("seed-asset-graph (fresh DB)", () => {
  it("creates one asset_kind row per catalog entry", async () => {
    const fake = makeFakeService()
    await seedAssetGraph({ container: makeContainer(fake) } as any)
    expect(fake.createAssetKinds).toHaveBeenCalledTimes(
      ASSET_KIND_CATALOG.length
    )
    expect(fake.updateAssetKinds).not.toHaveBeenCalled()
  })

  it("creates one project_manifest row per registered manifest", async () => {
    const fake = makeFakeService()
    await seedAssetGraph({ container: makeContainer(fake) } as any)
    expect(fake.createProjectManifests).toHaveBeenCalledTimes(
      MANIFEST_SLUGS.length
    )
    expect(fake.updateProjectManifests).not.toHaveBeenCalled()
  })

  it("encodes catalog fields verbatim into the create payload (slug, category, lifecycle, sensitivity)", async () => {
    const fake = makeFakeService()
    await seedAssetGraph({ container: makeContainer(fake) } as any)
    const sample = ASSET_KIND_CATALOG.find(
      (k) => k.slug === "skill.repair.electronics"
    )!
    const created = fake.createAssetKinds.mock.calls.find(
      (call: any[]) => call[0].slug === sample.slug
    )
    expect(created).toBeDefined()
    const payload = created![0] as any
    expect(payload.slug).toBe(sample.slug)
    expect(payload.category).toBe(sample.category)
    expect(payload.parent_slug).toBe(sample.parent_slug)
    expect(payload.display_name).toBe(sample.display_name)
    expect(payload.default_sensitivity_tier).toBe(sample.default_sensitivity_tier)
    expect(payload.default_lifecycle).toBe(sample.default_lifecycle)
  })

  it("stores a pointer-to-code marker rather than the zod schema itself for attribute_schema", async () => {
    const fake = makeFakeService()
    await seedAssetGraph({ container: makeContainer(fake) } as any)
    const created = fake.createAssetKinds.mock.calls[0][0] as any
    expect(created.attribute_schema).toEqual(
      expect.objectContaining({
        _note: expect.stringContaining("asset-kinds.ts"),
        _kind_slug: expect.any(String),
      })
    )
  })

  it("encodes manifest catalog fields verbatim into the create payload", async () => {
    const fake = makeFakeService()
    await seedAssetGraph({ container: makeContainer(fake) } as any)
    const repair = PROJECT_MANIFESTS["repair-cafe"]
    const created = fake.createProjectManifests.mock.calls.find(
      (call: any[]) => call[0].slug === "repair-cafe"
    )
    expect(created).toBeDefined()
    const payload = created![0] as any
    expect(payload.slug).toBe(repair.slug)
    expect(payload.version).toBe(repair.version)
    expect(payload.playbook_slug).toBe(repair.playbook_slug)
    expect(payload.surface).toBe(repair.surface)
    expect(payload.governance_model).toBe(repair.governance_model)
    expect(payload.sensitivity_floor).toBe(repair.sensitivity_floor)
    expect(payload.settlement_rails).toEqual(repair.settlement_rails)
    expect(payload.listing_type_slugs).toEqual(repair.listing_type_slugs)
    expect(payload.required_asset_kinds).toEqual(repair.required_asset_kinds)
    expect(payload.is_active).toBe(true)
  })
})

describe("seed-asset-graph (idempotent re-run)", () => {
  it("updates instead of creating when rows already exist", async () => {
    const fake = makeFakeService({
      withExistingKinds: true,
      withExistingManifests: true,
    })
    await seedAssetGraph({ container: makeContainer(fake) } as any)
    expect(fake.createAssetKinds).not.toHaveBeenCalled()
    expect(fake.createProjectManifests).not.toHaveBeenCalled()
    expect(fake.updateAssetKinds).toHaveBeenCalledTimes(
      ASSET_KIND_CATALOG.length
    )
    expect(fake.updateProjectManifests).toHaveBeenCalledTimes(
      MANIFEST_SLUGS.length
    )
  })

  it("passes the existing row id on update calls", async () => {
    const fake = makeFakeService({
      withExistingKinds: true,
      withExistingManifests: true,
    })
    await seedAssetGraph({ container: makeContainer(fake) } as any)
    for (const call of fake.updateAssetKinds.mock.calls) {
      expect((call[0] as any).id).toMatch(/^ak_/)
    }
    for (const call of fake.updateProjectManifests.mock.calls) {
      expect((call[0] as any).id).toMatch(/^pm_/)
    }
  })

  it("looks up by slug before deciding create vs. update", async () => {
    const fake = makeFakeService({ withExistingKinds: true })
    await seedAssetGraph({ container: makeContainer(fake) } as any)
    for (const def of ASSET_KIND_CATALOG) {
      expect(fake.listAssetKinds).toHaveBeenCalledWith({ slug: def.slug })
    }
    for (const slug of MANIFEST_SLUGS) {
      expect(fake.listProjectManifests).toHaveBeenCalledWith({ slug })
    }
  })
})
