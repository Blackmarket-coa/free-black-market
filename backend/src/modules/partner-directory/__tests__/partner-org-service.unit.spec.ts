import { PARTNER_ORG_VERIFICATION_FIELDS, normaliseEin, publishRefusal } from "../org-types"
import { makeInMemoryDirectory } from "./in-memory-partner-orgs"

/**
 * The service's two guards, pinned without a route in front of them. The
 * admin body schema already rejects verification fields, so a route spec
 * cannot show the service strips them on its own; this does, by handing the
 * service the fields the route never would (the integration spec shows the
 * same against Postgres).
 */
describe("PartnerDirectoryModuleService — partner_org guards", () => {
  it("strips every verification column from createOrg and updateOrg, whatever the caller passes", async () => {
    const dir = makeInMemoryDirectory()
    const smuggled: Record<string, unknown> = {
      verification_status: "pub78_eligible",
      verification_source: "typed_by_admin",
      verified_as_of: new Date("2026-09-01T00:00:00Z"),
      verification_checked_at: new Date("2026-09-15T00:00:00Z"),
    }

    const created = await dir.service.createOrg({ key: "smuggler", name: "Smuggler", org_type: "irs_501c3", ...smuggled })
    expect(created.verification_status).toBe("unverified")
    for (const field of PARTNER_ORG_VERIFICATION_FIELDS) {
      expect(dir.calls.create[0]).not.toHaveProperty(field)
    }

    await dir.service.updateOrg("smuggler", { name: "Still Smuggler", ...smuggled })
    for (const field of PARTNER_ORG_VERIFICATION_FIELDS) {
      expect(dir.calls.update[0]).not.toHaveProperty(field)
    }
    expect(dir.rows[0].verification_status).toBe("unverified")
    expect(dir.calls.update[0]).not.toHaveProperty("key")
  })

  it("refuses to publish an unverified IRS org type even with an ack, and a coop without one", async () => {
    const dir = makeInMemoryDirectory([
      { key: "c3", name: "C3", org_type: "irs_501c3" },
      { key: "coop", name: "Coop", org_type: "coop" },
    ])
    await expect(dir.service.updateOrg("c3", { published: true }, { publish_unverified_ack: true })).rejects.toMatchObject({
      code: "unverified_irs_org",
    })
    await expect(dir.service.updateOrg("coop", { published: true })).rejects.toMatchObject({
      code: "unverified_ack_required",
    })
    expect(dir.rows.map((r) => r.published)).toEqual([false, false])
    expect(dir.calls.update).toEqual([])
  })

  it("normalises the EIN and rejects a malformed one", async () => {
    const dir = makeInMemoryDirectory()
    const created = await dir.service.createOrg({ key: "ein_org", name: "EIN", ein: "01-2345678" })
    expect(created.ein).toBe("012345678")
    await expect(dir.service.updateOrg("ein_org", { ein: "12345" })).rejects.toThrow(/ein must be nine digits/)
    await dir.service.updateOrg("ein_org", { ein: null })
    expect(dir.rows[0].ein).toBeNull()
  })
})

describe("publishRefusal", () => {
  it("affirmed IRS status publishes any org type; everything else is refused with a distinct code", () => {
    for (const status of ["pub78_eligible", "bmf_only"] as const) {
      for (const org_type of ["irs_501c3", "irs_501c4", "coop", "unincorporated", null] as const) {
        expect(publishRefusal({ org_type, verification_status: status })).toBeNull()
      }
    }
    expect(publishRefusal({ org_type: null, verification_status: "unverified" })?.code).toBe("org_type_required")
    for (const status of ["unverified", "pending", "not_found", "revoked"] as const) {
      expect(publishRefusal({ org_type: "irs_501c3", verification_status: status })?.code).toBe("unverified_irs_org")
      expect(publishRefusal({ org_type: "irs_501c4", verification_status: status })?.code).toBe("unverified_irs_org")
      expect(publishRefusal({ org_type: "coop", verification_status: status })?.code).toBe("unverified_ack_required")
      expect(publishRefusal({ org_type: "coop", verification_status: status }, { publish_unverified_ack: true })).toBeNull()
    }
  })

  it("not_found and revoked are refused as themselves, never collapsed", () => {
    const notFound = publishRefusal({ org_type: "irs_501c3", verification_status: "not_found" })
    const revoked = publishRefusal({ org_type: "irs_501c3", verification_status: "revoked" })
    expect(notFound?.message).toContain("not_found")
    expect(revoked?.message).toContain("revoked")
    expect(notFound?.message).not.toEqual(revoked?.message)
  })

  it("names L11 in the refusal so the operator sees the checkpoint, not a validation error", () => {
    expect(publishRefusal({ org_type: "irs_501c3", verification_status: "unverified" })?.message).toMatch(/L11/)
  })
})

describe("normaliseEin", () => {
  it("accepts the hyphenated, bare and leading-zero-stripped forms", () => {
    expect(normaliseEin("12-3456789")).toBe("123456789")
    expect(normaliseEin("123456789")).toBe("123456789")
    expect(normaliseEin("1234567")).toBe("001234567")
    expect(normaliseEin(" 01-2345678 ")).toBe("012345678")
  })
  it("rejects anything else", () => {
    for (const bad of ["", "abc", "12345", "1234567890", "12-34-56789x"]) {
      expect(normaliseEin(bad)).toBeNull()
    }
    expect(normaliseEin(null)).toBeNull()
    expect(normaliseEin(undefined)).toBeNull()
  })
})
