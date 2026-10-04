import IrsExemptOrgModuleService from "../service"
import { currentRevocation, resolveIrsLookup, type IrsSourcesAsOf } from "../lookup"

const PUB78_AS_OF = new Date("2026-09-10T09:18:37Z")
const REVOCATION_AS_OF = new Date("2026-09-30T09:14:54Z")
const BMF_AS_OF = new Date("2026-09-07T04:13:27Z")
const asOf: IrsSourcesAsOf = { pub78: PUB78_AS_OF, revocation: REVOCATION_AS_OF, eo_bmf: BMF_AS_OF }

const rev = (posting: string, revocation: string, reinstatement: string | null = null) => ({
  posting_date: new Date(posting),
  revocation_date: new Date(revocation),
  reinstatement_date: reinstatement ? new Date(reinstatement) : null,
  exemption_type: "03",
})

/**
 * Four states, never a boolean, each carrying the date of the file that
 * produced it. The cases below are the real EINs in the fixtures and what
 * the live files of 2026-09 say about them.
 */
describe("resolveIrsLookup", () => {
  it("not_found when no file knows the EIN, with the newest file date and every source's date", () => {
    const result = resolveIrsLookup({ ein: "123456789", pub78: null, revocations: [], bmf: null, asOf })
    expect(result).toEqual({
      state: "not_found",
      ein: "123456789",
      as_of: REVOCATION_AS_OF,
      sources_as_of: asOf,
    })
  })

  it("not_found with as_of null when nothing has ever been ingested", () => {
    const empty: IrsSourcesAsOf = { pub78: null, revocation: null, eo_bmf: null }
    const result = resolveIrsLookup({ ein: "123456789", pub78: null, revocations: [], bmf: null, asOf: empty })
    expect(result.state).toBe("not_found")
    expect(result.as_of).toBeNull()
  })

  it("pub78_eligible carries the Pub 78 file date and the split codes, subsection from BMF", () => {
    const result = resolveIrsLookup({
      ein: "010017496",
      pub78: { deductibility_codes: "EO,GROUP,LODGE" },
      revocations: [],
      bmf: { subsection: "03", status: "01" },
      asOf,
    })
    expect(result).toEqual({
      state: "pub78_eligible",
      ein: "010017496",
      deductibility_codes: ["EO", "GROUP", "LODGE"],
      subsection: "03",
      as_of: PUB78_AS_OF,
    })
  })

  it("pub78_eligible without a BMF row has subsection null, not a guess", () => {
    const result = resolveIrsLookup({
      ein: "000587764",
      pub78: { deductibility_codes: "PC" },
      revocations: [],
      bmf: null,
      asOf,
    })
    expect(result.state).toBe("pub78_eligible")
    if (result.state === "pub78_eligible") expect(result.subsection).toBeNull()
  })

  it("bmf_only carries the BMF file date and says nothing about deductibility", () => {
    const result = resolveIrsLookup({
      ein: "010674736",
      pub78: null,
      revocations: [],
      bmf: { subsection: "04", status: "01" },
      asOf,
    })
    expect(result).toEqual({
      state: "bmf_only",
      ein: "010674736",
      subsection: "04",
      status: "01",
      as_of: BMF_AS_OF,
    })
    expect(result).not.toHaveProperty("deductibility_codes")
  })

  it("revoked when the revocation list has a current revocation and Pub 78 does not list the org (260089814)", () => {
    const result = resolveIrsLookup({
      ein: "260089814",
      pub78: null,
      revocations: [rev("2011-07-13", "2010-11-15")],
      bmf: { subsection: "07", status: "01" },
      asOf,
    })
    expect(result).toEqual({
      state: "revoked",
      ein: "260089814",
      revoked_on: new Date("2010-11-15"),
      posted_on: new Date("2011-07-13"),
      exemption_type: "03",
      as_of: REVOCATION_AS_OF,
    })
  })

  it("a reinstated revocation is history, not status (237069639 → bmf_only)", () => {
    const result = resolveIrsLookup({
      ein: "237069639",
      pub78: null,
      revocations: [rev("2011-10-07", "2010-12-15", "2010-12-15")],
      bmf: { subsection: "03", status: "01" },
      asOf,
    })
    expect(result.state).toBe("bmf_only")
  })

  it("revoked wins over Pub 78 when the posting is newer than the Pub 78 file (061681646, posted 29-SEP-2026)", () => {
    const result = resolveIrsLookup({
      ein: "061681646",
      pub78: { deductibility_codes: "PC" },
      revocations: [rev("2014-08-11", "2014-05-15", "2014-05-15"), rev("2026-09-29", "2024-05-15")],
      bmf: null,
      asOf,
    })
    expect(result.state).toBe("revoked")
    if (result.state === "revoked") {
      expect(result.posted_on).toEqual(new Date("2026-09-29"))
      expect(result.as_of).toEqual(REVOCATION_AS_OF)
    }
  })

  it("Pub 78 wins when it was published after the posting and still lists the org (030424472, posted 11-AUG-2014)", () => {
    const result = resolveIrsLookup({
      ein: "030424472",
      pub78: { deductibility_codes: "PC" },
      revocations: [rev("2014-08-11", "2014-05-15")],
      bmf: { subsection: "03", status: "01" },
      asOf,
    })
    expect(result.state).toBe("pub78_eligible")
    if (result.state === "pub78_eligible") expect(result.as_of).toEqual(PUB78_AS_OF)
  })

  it("revoked wins over Pub 78 when we hold no Pub 78 date to compare against", () => {
    const result = resolveIrsLookup({
      ein: "030424472",
      pub78: { deductibility_codes: "PC" },
      revocations: [rev("2014-08-11", "2014-05-15")],
      bmf: null,
      asOf: { ...asOf, pub78: null },
    })
    expect(result.state).toBe("revoked")
  })

  it("the newest posting speaks for the EIN (200644142: reinstated 2015, revoked again 2018)", () => {
    const rows = [rev("2012-02-22", "2011-05-15", "2015-09-15"), rev("2018-10-02", "2018-05-15")]
    expect(currentRevocation(rows)?.posting_date).toEqual(new Date("2018-10-02"))
    expect(currentRevocation([...rows].reverse())?.posting_date).toEqual(new Date("2018-10-02"))
    // Pub 78 (2026-09-10) is newer than the 2018 posting and lists the org.
    const result = resolveIrsLookup({ ein: "200644142", pub78: { deductibility_codes: "PC" }, revocations: rows, bmf: null, asOf })
    expect(result.state).toBe("pub78_eligible")
  })

  it("currentRevocation is null for no rows or when the newest row is reinstated", () => {
    expect(currentRevocation([])).toBeNull()
    expect(currentRevocation([rev("2013-10-21", "2013-06-15", "2013-06-15")])).toBeNull()
    expect(currentRevocation([rev("2013-10-21", "2013-06-15", "2013-06-15"), rev("2017-09-11", "2017-06-15")])).not.toBeNull()
  })

  it("accepts ISO strings for dates, as rows come back from a serialised repository", () => {
    const result = resolveIrsLookup({
      ein: "260089814",
      pub78: null,
      revocations: [{ posting_date: "2011-07-13T00:00:00.000Z", revocation_date: "2010-11-15T00:00:00.000Z", reinstatement_date: null, exemption_type: "07" }],
      bmf: null,
      asOf,
    })
    expect(result.state).toBe("revoked")
    if (result.state === "revoked") expect(result.revoked_on).toEqual(new Date("2010-11-15T00:00:00Z"))
  })
})

/**
 * The service's `lookupEin` normalises the EIN, reads each source's snapshot
 * for its as-of date and feeds the real rows to `resolveIrsLookup`. Stubbing
 * the generated repository methods on the real prototype proves the wiring
 * without a database.
 */
describe("IrsExemptOrgModuleService.lookupEin", () => {
  type Stubs = {
    pub78?: Array<{ ein: string; deductibility_codes: string }>
    revocations?: Array<Record<string, unknown>>
    bmf?: Array<{ ein: string; subsection: string | null; status: string | null }>
    snapshots?: Array<{ source: string; as_of: Date | string | null }>
  }

  const makeService = (stubs: Stubs) => {
    const svc = Object.create(IrsExemptOrgModuleService.prototype) as Record<string, unknown>
    const calls: Record<string, unknown[]> = { pub78: [], revocations: [], bmf: [] }
    svc.listIrsPub78Listings = (async (filters: { ein: string }) => {
      calls.pub78.push(filters)
      return (stubs.pub78 ?? []).filter((r) => r.ein === filters.ein)
    }) as never
    svc.listIrsRevocations = (async (filters: { ein: string }) => {
      calls.revocations.push(filters)
      return (stubs.revocations ?? []).filter((r) => r.ein === filters.ein)
    }) as never
    svc.listIrsExemptOrgs = (async (filters: { ein: string }) => {
      calls.bmf.push(filters)
      return (stubs.bmf ?? []).filter((r) => r.ein === filters.ein)
    }) as never
    svc.listIrsIngestSnapshots = (async () => stubs.snapshots ?? []) as never
    return { svc: svc as unknown as IrsExemptOrgModuleService, calls }
  }

  const snapshots = [
    { source: "pub78", as_of: PUB78_AS_OF },
    { source: "revocation", as_of: REVOCATION_AS_OF.toISOString() },
    { source: "eo_bmf", as_of: BMF_AS_OF },
  ]

  it("normalises the EIN before querying and returns the source's own as_of", async () => {
    const { svc, calls } = makeService({
      pub78: [{ ein: "000587764", deductibility_codes: "PC" }],
      snapshots,
    })
    const result = await svc.lookupEin("00-0587764")
    expect(calls.pub78).toEqual([{ ein: "000587764" }])
    expect(calls.revocations).toEqual([{ ein: "000587764" }])
    expect(calls.bmf).toEqual([{ ein: "000587764" }])
    expect(result).toEqual({
      state: "pub78_eligible",
      ein: "000587764",
      deductibility_codes: ["PC"],
      subsection: null,
      as_of: PUB78_AS_OF,
    })
  })

  it("coerces a string as_of from the repository into a Date", async () => {
    const { svc } = makeService({
      revocations: [
        { ein: "260089814", posting_date: "2011-07-13T00:00:00.000Z", revocation_date: "2010-11-15T00:00:00.000Z", reinstatement_date: null, exemption_type: "07" },
      ],
      snapshots,
    })
    const result = await svc.lookupEin(260089814)
    expect(result.state).toBe("revoked")
    expect(result.as_of).toEqual(REVOCATION_AS_OF)
  })

  it("an un-normalisable EIN is not_found without touching the tables", async () => {
    const { svc, calls } = makeService({ snapshots })
    const result = await svc.lookupEin("not-an-ein")
    expect(result.state).toBe("not_found")
    expect(result.as_of).toEqual(REVOCATION_AS_OF)
    expect(calls.pub78).toHaveLength(0)
    expect(calls.bmf).toHaveLength(0)
  })

  it("reports null dates for sources never ingested", async () => {
    const { svc } = makeService({ snapshots: [{ source: "eo_bmf", as_of: BMF_AS_OF }] })
    const result = await svc.lookupEin("123456789")
    expect(result).toEqual({
      state: "not_found",
      ein: "123456789",
      as_of: BMF_AS_OF,
      sources_as_of: { pub78: null, revocation: null, eo_bmf: BMF_AS_OF },
    })
  })
})
