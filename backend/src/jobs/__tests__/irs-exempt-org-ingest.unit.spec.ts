import irsExemptOrgIngest, { config, REVERIFY_BATCH_SIZE, runIrsExemptOrgIngest } from "../irs-exempt-org-ingest"
import { IRS_EXEMPT_ORG_MODULE } from "../../modules/irs-exempt-org/module-key"
import type { IrsLookupResult } from "../../modules/irs-exempt-org/lookup"
import { IRS_SOURCES } from "../../modules/irs-exempt-org/sources"
import { PARTNER_DIRECTORY_MODULE } from "../../modules/partner-directory"
import {
  makeInMemoryDirectory,
  type InMemoryDirectory,
  type OrgRow,
} from "../../modules/partner-directory/__tests__/in-memory-partner-orgs"
import { PHASE0_FEATURE_FLAGS } from "../../shared/feature-flags"
import type { FetchToFile, IngestOutcome } from "../../modules/irs-exempt-org/service"

const FLAG = PHASE0_FEATURE_FLAGS.NONPROFIT_PARITY_V1

/**
 * The job is a thin loop over the service. What has to be true of it: the
 * flag is consulted before the container is touched (with the flag off the
 * module may not even be registered), the module is resolved by its imported
 * key and not a hand-typed string, every source gets its turn even when one
 * fails, and the injected fetch reaches the service unchanged.
 *
 * After a swap it re-verifies every partner org with an EIN through the REAL
 * partner-directory service (prototype + shadowed CRUD), so the second half
 * of this file proves the sweep runs only after an `ingested` outcome, pages
 * the table, and lets `applyIrsLookup` unpublish a revoked org.
 */
const PUB78_AS_OF = new Date("2026-09-10T09:18:37Z")
const REVOCATION_AS_OF = new Date("2026-09-30T09:14:54Z")

const pub78For = (ein: string): IrsLookupResult => ({
  state: "pub78_eligible",
  ein,
  deductibility_codes: ["PC"],
  subsection: "03",
  subsection_as_of: null,
  as_of: PUB78_AS_OF,
})
const revokedFor = (ein: string): IrsLookupResult => ({
  state: "revoked",
  ein,
  revoked_on: new Date("2024-05-15T00:00:00Z"),
  posted_on: new Date("2024-08-12T00:00:00Z"),
  exemption_type: "03",
  as_of: REVOCATION_AS_OF,
})

const makeContainer = (
  ingestSource: (source: string, deps: unknown) => Promise<IngestOutcome>,
  opts: { dir?: InMemoryDirectory; lookupEin?: (ein: string) => Promise<IrsLookupResult> } = {}
) => {
  const dir = opts.dir ?? makeInMemoryDirectory()
  const lookupEin = jest.fn(opts.lookupEin ?? (async (ein: string) => pub78For(ein)))
  const resolve = jest.fn((key: string) => {
    // The real awilix container throws on an unknown key; a stub that returned
    // something for any string would let a wrong key pass silently.
    if (key === IRS_EXEMPT_ORG_MODULE) return { ingestSource, lookupEin }
    if (key === PARTNER_DIRECTORY_MODULE) return dir.service
    throw new Error(`Could not resolve '${key}'`)
  })
  return { container: { resolve } as never, resolve, dir, lookupEin }
}

const ingested = (source: string): IngestOutcome =>
  ({ source, outcome: "ingested", row_count: 50, as_of: PUB78_AS_OF }) as IngestOutcome
const unchanged = (source: string): IngestOutcome => ({ source, outcome: "skipped_unchanged", as_of: null }) as IngestOutcome
const failed = (source: string): IngestOutcome => ({ source, outcome: "failed", error: `${source}: boom` }) as IngestOutcome

const org = (key: string, overrides: Partial<OrgRow> = {}): Partial<OrgRow> & { key: string; name: string } => ({
  key,
  name: key,
  org_type: "irs_501c3",
  ein: "123456789",
  ...overrides,
})

const fakeFetch: FetchToFile = async () => ({
  status: 304,
  lastModified: null,
  etag: null,
  sha256: null,
  bytes: 0,
})

describe("irs-exempt-org-ingest job", () => {
  afterEach(() => {
    delete process.env[FLAG]
  })

  it("is weekly, not monthly, and named for its README row", () => {
    expect(config).toEqual({ name: "irs-exempt-org-ingest", schedule: "0 4 * * 0" })
  })

  it("with the flag off, returns null and never resolves the module (default handler)", async () => {
    const ingestSource = jest.fn()
    const { container, resolve } = makeContainer(ingestSource)
    expect(await irsExemptOrgIngest(container)).toBeNull()
    expect(resolve).not.toHaveBeenCalled()
    expect(ingestSource).not.toHaveBeenCalled()
  })

  it("with the flag off, the exported body also stops before the container", async () => {
    process.env[FLAG] = "TRUE" // only the literal lowercase string enables
    const ingestSource = jest.fn()
    const { container, resolve } = makeContainer(ingestSource)
    expect(await runIrsExemptOrgIngest(container, { fetchToFile: fakeFetch })).toBeNull()
    expect(resolve).not.toHaveBeenCalled()
  })

  it("with the flag on, resolves the module by its imported key and ingests every source in order", async () => {
    process.env[FLAG] = "true"
    const seen: string[] = []
    const ingestSource = jest.fn(async (source: string, deps: { fetchToFile: FetchToFile; now: () => Date }) => {
      seen.push(source)
      expect(deps.fetchToFile).toBe(fakeFetch)
      expect(deps.now()).toEqual(new Date("2026-10-04T04:00:00Z"))
      return { source, outcome: "skipped_unchanged", as_of: null } as IngestOutcome
    })
    const { container, resolve } = makeContainer(ingestSource)
    const result = await runIrsExemptOrgIngest(container, {
      fetchToFile: fakeFetch,
      now: () => new Date("2026-10-04T04:00:00Z"),
    })

    expect(resolve).toHaveBeenCalledWith(IRS_EXEMPT_ORG_MODULE)
    expect(seen).toEqual([...IRS_SOURCES])
    expect(result?.results.map((r) => r.outcome)).toEqual([
      "skipped_unchanged",
      "skipped_unchanged",
      "skipped_unchanged",
    ])
  })

  it("sources degrade independently: a thrown error in one does not stop the others", async () => {
    process.env[FLAG] = "true"
    const ingestSource = jest.fn(async (source: string) => {
      if (source === "revocation") throw new Error("no database connection reachable")
      if (source === "eo_bmf") return { source, outcome: "failed", error: "eo-bmf: header is missing required column EIN" } as IngestOutcome
      return { source, outcome: "ingested", row_count: 50, as_of: new Date("2026-09-10T09:18:37Z") } as IngestOutcome
    })
    const { container } = makeContainer(ingestSource)
    const result = await runIrsExemptOrgIngest(container, { fetchToFile: fakeFetch })

    expect(ingestSource).toHaveBeenCalledTimes(3)
    expect(result?.results).toEqual([
      { source: "pub78", outcome: "ingested", row_count: 50, as_of: new Date("2026-09-10T09:18:37Z") },
      { source: "revocation", outcome: "failed", error: "no database connection reachable" },
      { source: "eo_bmf", outcome: "failed", error: "eo-bmf: header is missing required column EIN" },
    ])
    // One source swapped, so the sweep still ran — over an empty table here.
    expect(result?.reverify).toMatchObject({ checked: 0, applied: 0, auto_unpublished: [], failed: [] })
  })

  it("honours a source subset (the operator script's path)", async () => {
    process.env[FLAG] = "true"
    const ingestSource = jest.fn(async (source: string) => ({ source, outcome: "skipped_unchanged", as_of: null }) as IngestOutcome)
    const { container } = makeContainer(ingestSource)
    await runIrsExemptOrgIngest(container, { fetchToFile: fakeFetch, sources: ["pub78"] })
    expect(ingestSource).toHaveBeenCalledTimes(1)
    expect(ingestSource.mock.calls[0][0]).toBe("pub78")
  })

  it("the default handler reaches the same body when the flag is on", async () => {
    process.env[FLAG] = "true"
    const ingestSource = jest.fn(async (source: string) => ({ source, outcome: "skipped_unchanged", as_of: null }) as IngestOutcome)
    const { container, resolve } = makeContainer(ingestSource)
    const result = await irsExemptOrgIngest(container)
    expect(resolve).toHaveBeenCalledWith(IRS_EXEMPT_ORG_MODULE)
    expect(result?.results).toHaveLength(3)
  })
})

describe("irs-exempt-org-ingest job — post-ingest re-verification of partner orgs", () => {
  beforeEach(() => {
    process.env[FLAG] = "true"
  })
  afterEach(() => {
    delete process.env[FLAG]
  })

  it("is 200 rows per page by default", () => {
    expect(REVERIFY_BATCH_SIZE).toBe(200)
  })

  it("after a successful swap of ANY source, re-verifies every org with an EIN and unpublishes a revoked one", async () => {
    const dir = makeInMemoryDirectory([
      org("published_c3", { published: true, verification_status: "pub78_eligible", verified_as_of: new Date("2026-08-12T00:00:00Z") }),
      org("quiet_c3", { ein: "000000002" }),
      org("no_ein", { ein: null }),
      org("a_coop", { org_type: "coop", ein: "000000003", published: true }),
    ])
    // Only the revocation list changed this week; Pub 78 and the BMF are unchanged.
    const ingestSource = jest.fn(async (source: string) => (source === "revocation" ? ingested(source) : unchanged(source)))
    const { container, dir: d, lookupEin } = makeContainer(ingestSource, {
      dir,
      lookupEin: async (ein) => (ein === "123456789" ? revokedFor(ein) : pub78For(ein)),
    })

    const result = await runIrsExemptOrgIngest(container, { fetchToFile: fakeFetch, now: () => new Date("2026-10-04T04:00:00Z") })

    // Three rows carry an EIN; the one with none is never looked up.
    expect(lookupEin).toHaveBeenCalledTimes(3)
    expect(lookupEin.mock.calls.map((c) => c[0]).sort()).toEqual(["000000002", "000000003", "123456789"])

    expect(result?.reverify).toEqual({
      checked: 3,
      applied: 2,
      skipped: { no_ein: 0, non_irs_org_type: 1, no_irs_file: 0 },
      auto_unpublished: ["published_c3"],
      failed: [],
    })

    const byKey = Object.fromEntries(d.rows.map((r) => [r.key, r]))
    expect(byKey.published_c3).toMatchObject({
      published: false,
      verification_status: "revoked",
      verification_source: "irs_bulk_file",
      verified_as_of: REVOCATION_AS_OF,
      verification_checked_at: new Date("2026-10-04T04:00:00Z"),
    })
    expect(byKey.published_c3.metadata).toMatchObject({ auto_unpublished: { reason: "unverified_irs_org", verification_status: "revoked" } })
    expect(byKey.quiet_c3).toMatchObject({ verification_status: "pub78_eligible", verified_as_of: PUB78_AS_OF, published: false })
    // The coop stays as the operator left it: published, unverified, undated.
    expect(byKey.a_coop).toMatchObject({ published: true, verification_status: "unverified", verified_as_of: null })
    expect(byKey.no_ein).toMatchObject({ verification_status: "unverified" })
  })

  it("never re-verifies after a run in which nothing was ingested (all unchanged)", async () => {
    const dir = makeInMemoryDirectory([org("published_c3", { published: true, verification_status: "pub78_eligible" })])
    const ingestSource = jest.fn(async (source: string) => unchanged(source))
    const { container, lookupEin, resolve } = makeContainer(ingestSource, { dir, lookupEin: async (ein) => revokedFor(ein) })

    const result = await runIrsExemptOrgIngest(container, { fetchToFile: fakeFetch })

    expect(result?.reverify).toBeNull()
    expect(lookupEin).not.toHaveBeenCalled()
    expect(resolve).not.toHaveBeenCalledWith(PARTNER_DIRECTORY_MODULE)
    expect(dir.rows[0]).toMatchObject({ published: true, verification_status: "pub78_eligible" })
    expect(dir.calls.update).toEqual([])
  })

  it("never re-verifies after a failed run, even one that would have revoked an org", async () => {
    const dir = makeInMemoryDirectory([org("published_c3", { published: true, verification_status: "pub78_eligible" })])
    const ingestSource = jest.fn(async (source: string) => (source === "pub78" ? unchanged(source) : failed(source)))
    const { container, lookupEin, resolve } = makeContainer(ingestSource, { dir, lookupEin: async (ein) => revokedFor(ein) })

    const result = await runIrsExemptOrgIngest(container, { fetchToFile: fakeFetch })

    expect(result?.results.map((r) => r.outcome)).toEqual(["skipped_unchanged", "failed", "failed"])
    expect(result?.reverify).toBeNull()
    expect(lookupEin).not.toHaveBeenCalled()
    expect(resolve).not.toHaveBeenCalledWith(PARTNER_DIRECTORY_MODULE)
    expect(dir.rows[0].published).toBe(true)
  })

  it("pages the table in batches and reaches every row", async () => {
    const rows = Array.from({ length: 450 }, (_, i) => org(`org_${String(i).padStart(3, "0")}`, { ein: String(i + 1).padStart(9, "0") }))
    const dir = makeInMemoryDirectory(rows)
    const pages = jest.spyOn(dir.service, "listOrgsWithEin")
    const ingestSource = jest.fn(async (source: string) => ingested(source))
    const { container, lookupEin } = makeContainer(ingestSource, { dir })

    const result = await runIrsExemptOrgIngest(container, { fetchToFile: fakeFetch, reverifyBatchSize: 200 })

    expect(pages.mock.calls.map((c) => c[0])).toEqual([
      { skip: 0, take: 200 },
      { skip: 200, take: 200 },
      { skip: 400, take: 200 },
    ])
    expect(lookupEin).toHaveBeenCalledTimes(450)
    expect(result?.reverify).toMatchObject({ checked: 450, applied: 450 })
    expect(dir.rows.every((r) => r.verification_status === "pub78_eligible")).toBe(true)
  })

  it("a row whose lookup throws is recorded as failed and the sweep carries on", async () => {
    const dir = makeInMemoryDirectory([org("bad", { ein: "000000001" }), org("good", { ein: "000000002" })])
    const ingestSource = jest.fn(async (source: string) => ingested(source))
    const { container } = makeContainer(ingestSource, {
      dir,
      lookupEin: async (ein) => {
        if (ein === "000000001") throw new Error("connection reset")
        return pub78For(ein)
      },
    })

    const result = await runIrsExemptOrgIngest(container, { fetchToFile: fakeFetch })

    expect(result?.reverify).toMatchObject({ checked: 2, applied: 1, failed: ["bad"] })
    expect(dir.rows.find((r) => r.key === "good")?.verification_status).toBe("pub78_eligible")
    expect(dir.rows.find((r) => r.key === "bad")?.verification_status).toBe("unverified")
  })

  it("the default handler runs the sweep too", async () => {
    const dir = makeInMemoryDirectory([org("c3")])
    const ingestSource = jest.fn(async (source: string) => ingested(source))
    const { container, resolve } = makeContainer(ingestSource, { dir })
    const result = await irsExemptOrgIngest(container)
    expect(resolve).toHaveBeenCalledWith(PARTNER_DIRECTORY_MODULE)
    expect(result?.reverify).toMatchObject({ checked: 1, applied: 1 })
    expect(dir.rows[0].verification_status).toBe("pub78_eligible")
  })
})
