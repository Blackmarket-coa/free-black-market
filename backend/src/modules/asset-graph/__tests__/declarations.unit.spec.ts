/**
 * Member-side declaration tests.
 *
 * Covers the two service methods that back the `/store/asset-graph/`
 * declaration routes:
 *
 *   createDeclarationFor({ member_id, kind_slug, attributes, ... })
 *     Validates that the kind exists, that the attributes match the
 *     kind's zod attribute_schema (strict — unknown keys rejected),
 *     and that lifecycle / sensitivity_tier default from the kind.
 *
 *   revokeDeclaration({ declaration_id, member_id })
 *     Sets revoked_at when the caller owns the declaration; returns
 *     null when the declaration is missing or owned by someone else
 *     (routes 404 either case — don't leak existence).
 *
 * Service layer covered with fake DB methods; same pattern as
 * settlement.unit.spec.ts and instance-lifecycle.unit.spec.ts.
 */

import AssetGraphService from "../service"

type FakeDecl = {
  id: string
  member_id: string
  kind_slug: string
  attributes: Record<string, unknown>
  sensitivity_tier: string
  lifecycle: string
  governance_model: string
  availability: Record<string, unknown> | null
  geography: Record<string, unknown> | null
  metadata: Record<string, unknown> | null
  revoked_at: Date | null
}

const buildFakeService = (
  fixtures: { declarations?: Record<string, FakeDecl> } = {}
) => {
  const rows: Record<string, FakeDecl> = { ...(fixtures.declarations ?? {}) }
  const inst = Object.create(AssetGraphService.prototype)
  inst.createAssetDeclarations = jest.fn(async (payload: any) => {
    const id = payload.id ?? `decl_${Object.keys(rows).length + 1}`
    const row: FakeDecl = {
      id,
      member_id: payload.member_id,
      kind_slug: payload.kind_slug,
      attributes: payload.attributes,
      sensitivity_tier: payload.sensitivity_tier,
      lifecycle: payload.lifecycle,
      governance_model: payload.governance_model,
      availability: payload.availability,
      geography: payload.geography,
      metadata: payload.metadata,
      revoked_at: null,
    }
    rows[id] = row
    return row
  })
  inst.retrieveAssetDeclaration = jest.fn(async (id: string) => {
    return rows[id] ?? null
  })
  inst.updateAssetDeclarations = jest.fn(async (payload: any) => {
    if (!rows[payload.id]) throw new Error(`No row ${payload.id}`)
    rows[payload.id] = { ...rows[payload.id], ...payload }
    return rows[payload.id]
  })
  return { service: inst as AssetGraphService, rows }
}

describe("createDeclarationFor", () => {
  it("validates attributes against the kind's zod schema and writes the row", async () => {
    const { service, rows } = buildFakeService()
    const decl = await service.createDeclarationFor({
      member_id: "mem_a",
      kind_slug: "land.yard.residential",
      attributes: { acreage: 0.30, soil_tested: true },
    })
    expect(decl.member_id).toBe("mem_a")
    expect(decl.kind_slug).toBe("land.yard.residential")
    expect(decl.attributes).toEqual({ acreage: 0.30, soil_tested: true })
    expect(Object.keys(rows)).toHaveLength(1)
  })

  it("defaults lifecycle from the kind when not supplied", async () => {
    const { service } = buildFakeService()
    const decl = await service.createDeclarationFor({
      member_id: "mem_a",
      kind_slug: "land.yard.residential",
      attributes: { acreage: 0.30 },
    })
    // land.yard.residential's default_lifecycle is durable-commitment.
    expect(decl.lifecycle).toBe("durable-commitment")
  })

  it("defaults sensitivity_tier from the kind when not supplied", async () => {
    const { service } = buildFakeService()
    const decl = await service.createDeclarationFor({
      member_id: "mem_a",
      kind_slug: "credential.cpr-certified",
      attributes: { levels: ["adult", "child"] },
    })
    // credential.cpr-certified's default is match-only.
    expect(decl.sensitivity_tier).toBe("match-only")
  })

  it("respects caller-supplied lifecycle override", async () => {
    const { service } = buildFakeService()
    const decl = await service.createDeclarationFor({
      member_id: "mem_a",
      kind_slug: "tool.power-tool",
      attributes: { corded: true },
      lifecycle: "exhaustible-borrow-return",
    })
    expect(decl.lifecycle).toBe("exhaustible-borrow-return")
  })

  it("respects caller-supplied sensitivity_tier override", async () => {
    const { service } = buildFakeService()
    const decl = await service.createDeclarationFor({
      member_id: "mem_a",
      kind_slug: "skill.horticulture",
      attributes: { years_experience: 8 },
      sensitivity_tier: "public",
    })
    expect(decl.sensitivity_tier).toBe("public")
  })

  it("defaults governance_model to 'individual'", async () => {
    const { service } = buildFakeService()
    const decl = await service.createDeclarationFor({
      member_id: "mem_a",
      kind_slug: "skill.horticulture",
      attributes: {},
    })
    expect(decl.governance_model).toBe("individual")
  })

  it("throws on unknown kind_slug", async () => {
    const { service } = buildFakeService()
    await expect(
      service.createDeclarationFor({
        member_id: "mem_a",
        kind_slug: "this.kind.does-not.exist",
        attributes: {},
      })
    ).rejects.toThrow(/Unknown asset kind/)
  })

  it("rejects attributes that fail the kind's zod schema", async () => {
    const { service } = buildFakeService()
    await expect(
      service.createDeclarationFor({
        member_id: "mem_a",
        kind_slug: "land.yard.residential",
        // acreage must be positive number; missing required field
        attributes: {} as any,
      })
    ).rejects.toThrow()
  })

  it("rejects unknown attribute keys (zod strict mode)", async () => {
    const { service } = buildFakeService()
    await expect(
      service.createDeclarationFor({
        member_id: "mem_a",
        kind_slug: "land.yard.residential",
        attributes: { acreage: 0.30, totally_made_up_field: "yikes" } as any,
      })
    ).rejects.toThrow()
  })

  it("rejects wrong-type values (zod strict)", async () => {
    const { service } = buildFakeService()
    await expect(
      service.createDeclarationFor({
        member_id: "mem_a",
        kind_slug: "land.yard.residential",
        // acreage must be number; string fails
        attributes: { acreage: "lots" } as any,
      })
    ).rejects.toThrow()
  })

  it("creates a credential declaration with the right defaults (match-only sensitivity)", async () => {
    const { service } = buildFakeService()
    const decl = await service.createDeclarationFor({
      member_id: "mem_caregiver",
      kind_slug: "credential.background-check",
      attributes: { cleared: true, scope: ["childcare"] },
    })
    expect(decl.sensitivity_tier).toBe("match-only")
    expect(decl.lifecycle).toBe("durable-commitment")
  })
})

describe("revokeDeclaration", () => {
  it("sets revoked_at when the caller owns the declaration", async () => {
    const { service, rows } = buildFakeService({
      declarations: {
        d_1: {
          id: "d_1",
          member_id: "mem_a",
          kind_slug: "skill.horticulture",
          attributes: {},
          sensitivity_tier: "member-visible",
          lifecycle: "durable-commitment",
          governance_model: "individual",
          availability: null,
          geography: null,
          metadata: null,
          revoked_at: null,
        },
      },
    })
    const updated = await service.revokeDeclaration({
      declaration_id: "d_1",
      member_id: "mem_a",
    })
    expect(updated).not.toBeNull()
    expect(rows.d_1.revoked_at).toBeInstanceOf(Date)
  })

  it("returns null when the declaration belongs to a different member", async () => {
    const { service, rows } = buildFakeService({
      declarations: {
        d_1: {
          id: "d_1",
          member_id: "mem_a",
          kind_slug: "skill.horticulture",
          attributes: {},
          sensitivity_tier: "member-visible",
          lifecycle: "durable-commitment",
          governance_model: "individual",
          availability: null,
          geography: null,
          metadata: null,
          revoked_at: null,
        },
      },
    })
    const result = await service.revokeDeclaration({
      declaration_id: "d_1",
      member_id: "mem_b",
    })
    expect(result).toBeNull()
    // Ownership check failed; row is unchanged.
    expect(rows.d_1.revoked_at).toBeNull()
  })

  it("returns null when the declaration does not exist", async () => {
    const { service } = buildFakeService()
    const result = await service.revokeDeclaration({
      declaration_id: "d_ghost",
      member_id: "mem_a",
    })
    expect(result).toBeNull()
  })
})
