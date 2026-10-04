import {
  IRS_BULK_FILE_SOURCE,
  IRS_LOOKUP_TO_VERIFICATION,
  type AutoUnpublishRecord,
} from "../service"
import { PARTNER_ORG_VERIFICATION } from "../org-types"
import type { IrsLookupResult, IrsLookupState } from "../../irs-exempt-org/lookup"
import { makeInMemoryDirectory, type OrgRow } from "./in-memory-partner-orgs"

/**
 * `applyIrsLookup` is the only writer of the four verification columns, and
 * it writes them from a lookup result. What has to hold, against the REAL
 * service (prototype + shadowed CRUD):
 *
 * - each of the four lookup states lands on its own verification state, with
 *   the file's date as `verified_as_of` and the run time as `checked_at`;
 * - no EIN, a coop / unincorporated type, or a lookup with no file date
 *   writes nothing — those orgs stay `unverified`, never `not_found`;
 * - a revoked or not_found result on a published IRS org unpublishes it and
 *   says why in metadata; an affirmed result on a published org does not.
 */
const EIN = "123456789"
const PUB78_AS_OF = new Date("2026-09-10T09:18:37Z")
const REVOCATION_AS_OF = new Date("2026-09-30T09:14:54Z")
const BMF_AS_OF = new Date("2026-09-07T04:13:27Z")
const CHECKED_AT = new Date("2026-10-04T04:00:00Z")

const lookups: Record<IrsLookupState, IrsLookupResult> = {
  pub78_eligible: {
    state: "pub78_eligible",
    ein: EIN,
    deductibility_codes: ["PC"],
    subsection: "03",
    subsection_as_of: BMF_AS_OF,
    as_of: PUB78_AS_OF,
  },
  bmf_only: { state: "bmf_only", ein: EIN, subsection: "04", status: "01", as_of: BMF_AS_OF },
  not_found: {
    state: "not_found",
    ein: EIN,
    as_of: REVOCATION_AS_OF,
    sources_as_of: { pub78: PUB78_AS_OF, revocation: REVOCATION_AS_OF, eo_bmf: BMF_AS_OF },
  },
  revoked: {
    state: "revoked",
    ein: EIN,
    revoked_on: new Date("2024-05-15T00:00:00Z"),
    posted_on: new Date("2024-08-12T00:00:00Z"),
    exemption_type: "03",
    as_of: REVOCATION_AS_OF,
  },
}

const org501c3 = (overrides: Partial<OrgRow> = {}): Partial<OrgRow> & { key: string; name: string } => ({
  key: "example_501c3",
  name: "Example 501(c)(3)",
  org_type: "irs_501c3",
  ein: EIN,
  ...overrides,
})

describe("updateOrg resets IRS verification when an org is retyped to a non-IRS type", () => {
  it("clears status, source and both dates on irs_501c3 -> coop, and leaves them alone on an unrelated patch", async () => {
    const dir = makeInMemoryDirectory([
      {
        key: "retyped",
        name: "Retyped",
        org_type: "irs_501c3",
        ein: "000587764",
        verification_status: "not_found",
        verification_source: "irs_bulk_file",
        verified_as_of: new Date("2026-09-10T00:00:00Z"),
        verification_checked_at: new Date("2026-10-04T04:00:00Z"),
      },
    ])
    const untouched = await dir.service.updateOrg("retyped", { name: "Still Retyped" })
    expect(untouched.verification_status).toBe("not_found")

    const retyped = await dir.service.updateOrg("retyped", { org_type: "coop" })
    expect(retyped.org_type).toBe("coop")
    expect(retyped.verification_status).toBe("unverified")
    expect(retyped.verification_source).toBeNull()
    expect(retyped.verified_as_of).toBeNull()
    expect(retyped.verification_checked_at).toBeNull()
  })
})

describe("IRS_LOOKUP_TO_VERIFICATION", () => {
  it("maps each lookup state to the verification state of the same name, all of which the model knows", () => {
    expect(IRS_LOOKUP_TO_VERIFICATION).toEqual({
      pub78_eligible: "pub78_eligible",
      bmf_only: "bmf_only",
      not_found: "not_found",
      revoked: "revoked",
    })
    for (const status of Object.values(IRS_LOOKUP_TO_VERIFICATION)) {
      expect(PARTNER_ORG_VERIFICATION).toContain(status)
    }
    // Never to the "never asked" state, and never collapsed.
    expect(Object.values(IRS_LOOKUP_TO_VERIFICATION)).not.toContain("unverified")
    expect(new Set(Object.values(IRS_LOOKUP_TO_VERIFICATION)).size).toBe(4)
  })
})

describe("PartnerDirectoryModuleService.applyIrsLookup", () => {
  it.each(Object.keys(lookups) as IrsLookupState[])(
    "%s → verification_status of the same name, source irs_bulk_file, as-of from the file, checked_at from the run",
    async (state) => {
      const dir = makeInMemoryDirectory([org501c3()])
      const result = await dir.service.applyIrsLookup("example_501c3", lookups[state], CHECKED_AT)

      expect(result.applied).toBe(true)
      expect(dir.rows[0]).toMatchObject({
        verification_status: state,
        verification_source: IRS_BULK_FILE_SOURCE,
        verified_as_of: lookups[state].as_of,
        verification_checked_at: CHECKED_AT,
      })
      expect(dir.calls.update).toHaveLength(1)
      // An unpublished row stays unpublished and gains no metadata.
      expect(dir.rows[0].published).toBe(false)
      expect(dir.calls.update[0]).not.toHaveProperty("published")
      expect(dir.calls.update[0]).not.toHaveProperty("metadata")
    }
  )

  it("verified_as_of is the file date, distinct from the check time", async () => {
    const dir = makeInMemoryDirectory([org501c3()])
    await dir.service.applyIrsLookup("example_501c3", lookups.pub78_eligible, CHECKED_AT)
    expect(dir.rows[0].verified_as_of).toEqual(PUB78_AS_OF)
    expect(dir.rows[0].verification_checked_at).toEqual(CHECKED_AT)
    expect(dir.rows[0].verified_as_of).not.toEqual(dir.rows[0].verification_checked_at)
  })

  it("an org with no EIN is left unverified and nothing is written", async () => {
    const dir = makeInMemoryDirectory([org501c3({ ein: null })])
    const result = await dir.service.applyIrsLookup("example_501c3", lookups.not_found, CHECKED_AT)
    expect(result).toMatchObject({ applied: false, reason: "no_ein" })
    expect(dir.rows[0].verification_status).toBe("unverified")
    expect(dir.calls.update).toEqual([])
  })

  it.each(["coop", "unincorporated"] as const)(
    "a %s is left unverified — the IRS has no opinion, so not_found would be a lie — even when published",
    async (org_type) => {
      const dir = makeInMemoryDirectory([org501c3({ org_type, published: true })])
      for (const state of Object.keys(lookups) as IrsLookupState[]) {
        const result = await dir.service.applyIrsLookup("example_501c3", lookups[state], CHECKED_AT)
        expect(result).toMatchObject({ applied: false, reason: "non_irs_org_type" })
      }
      expect(dir.rows[0]).toMatchObject({ verification_status: "unverified", published: true, verified_as_of: null })
      expect(dir.calls.update).toEqual([])
    }
  )

  it("a lookup with no file date (nothing ingested yet) writes nothing: a status without an as-of is what L11 forbids", async () => {
    const dir = makeInMemoryDirectory([org501c3()])
    const undated: IrsLookupResult = {
      state: "not_found",
      ein: EIN,
      as_of: null,
      sources_as_of: { pub78: null, revocation: null, eo_bmf: null },
    }
    const result = await dir.service.applyIrsLookup("example_501c3", undated, CHECKED_AT)
    expect(result).toMatchObject({ applied: false, reason: "no_irs_file" })
    expect(dir.rows[0].verification_status).toBe("unverified")
    expect(dir.calls.update).toEqual([])
  })

  it("refuses a lookup for a different EIN than the org's", async () => {
    const dir = makeInMemoryDirectory([org501c3()])
    await expect(
      dir.service.applyIrsLookup("example_501c3", { ...lookups.pub78_eligible, ein: "987654321" }, CHECKED_AT)
    ).rejects.toThrow(/EIN 987654321, not this org's EIN 123456789/)
    expect(dir.calls.update).toEqual([])
  })

  it("404s an unknown org key", async () => {
    const dir = makeInMemoryDirectory()
    await expect(dir.service.applyIrsLookup("ghost", lookups.pub78_eligible, CHECKED_AT)).rejects.toThrow(/not found/)
  })

  it.each(["revoked", "not_found"] as const)(
    "%s on a published 501c3 unpublishes it and records the reason and time in metadata",
    async (state) => {
      const dir = makeInMemoryDirectory([
        org501c3({
          published: true,
          verification_status: "pub78_eligible",
          verified_as_of: new Date("2026-08-12T00:00:00Z"),
          metadata: { note: "operator note survives" },
        }),
      ])
      const result = await dir.service.applyIrsLookup("example_501c3", lookups[state], CHECKED_AT)

      expect(result).toMatchObject({ applied: true, auto_unpublished: true })
      expect(dir.rows[0].published).toBe(false)
      expect(dir.rows[0].verification_status).toBe(state)
      const record = (dir.rows[0].metadata as { auto_unpublished: AutoUnpublishRecord }).auto_unpublished
      expect(record).toEqual({
        reason: "unverified_irs_org",
        verification_status: state,
        verified_as_of: lookups[state].as_of!.toISOString(),
        at: CHECKED_AT.toISOString(),
      })
      expect(dir.rows[0].metadata).toMatchObject({ note: "operator note survives" })
    }
  )

  it("revoked on a published 501c4 unpublishes it too", async () => {
    const dir = makeInMemoryDirectory([org501c3({ org_type: "irs_501c4", published: true, verification_status: "bmf_only" })])
    const result = await dir.service.applyIrsLookup("example_501c3", lookups.revoked, CHECKED_AT)
    expect(result).toMatchObject({ applied: true, auto_unpublished: true })
    expect(dir.rows[0].published).toBe(false)
  })

  it.each(["pub78_eligible", "bmf_only"] as const)(
    "%s on a published org keeps it published and leaves metadata alone",
    async (state) => {
      const dir = makeInMemoryDirectory([org501c3({ published: true, verification_status: "pub78_eligible", metadata: null })])
      const result = await dir.service.applyIrsLookup("example_501c3", lookups[state], CHECKED_AT)
      expect(result).toMatchObject({ applied: true, auto_unpublished: false })
      expect(dir.rows[0].published).toBe(true)
      expect(dir.rows[0].metadata).toBeNull()
      expect(dir.calls.update[0]).not.toHaveProperty("published")
    }
  )

  it("not_found on an unpublished 501c3 is recorded as not_found, not as unverified, and reports no auto-unpublish", async () => {
    const dir = makeInMemoryDirectory([org501c3()])
    const result = await dir.service.applyIrsLookup("example_501c3", lookups.not_found, CHECKED_AT)
    expect(result).toMatchObject({ applied: true, auto_unpublished: false })
    expect(dir.rows[0].verification_status).toBe("not_found")
    expect(dir.rows[0].metadata).toBeNull()
  })
})

describe("PartnerDirectoryModuleService.listOrgsWithEin", () => {
  it("pages over the rows that carry an EIN, in id order, and nothing else", async () => {
    const dir = makeInMemoryDirectory([
      { key: "a", name: "A", ein: "000000001" },
      { key: "no_ein", name: "No EIN", ein: null },
      { key: "b", name: "B", ein: "000000002" },
      { key: "c", name: "C", ein: "000000003" },
    ])
    const first = await dir.service.listOrgsWithEin({ skip: 0, take: 2 })
    const second = await dir.service.listOrgsWithEin({ skip: 2, take: 2 })
    expect(first.map((o) => o.key)).toEqual(["a", "b"])
    expect(second.map((o) => o.key)).toEqual(["c"])
  })
})
