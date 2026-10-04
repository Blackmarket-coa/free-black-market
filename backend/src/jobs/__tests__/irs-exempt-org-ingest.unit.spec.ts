import irsExemptOrgIngest, { config, runIrsExemptOrgIngest } from "../irs-exempt-org-ingest"
import { IRS_EXEMPT_ORG_MODULE } from "../../modules/irs-exempt-org/module-key"
import { IRS_SOURCES } from "../../modules/irs-exempt-org/sources"
import { PHASE0_FEATURE_FLAGS } from "../../shared/feature-flags"
import type { FetchToFile, IngestOutcome } from "../../modules/irs-exempt-org/service"

const FLAG = PHASE0_FEATURE_FLAGS.NONPROFIT_PARITY_V1

/**
 * The job is a thin loop over the service. What has to be true of it: the
 * flag is consulted before the container is touched (with the flag off the
 * module may not even be registered), the module is resolved by its imported
 * key and not a hand-typed string, every source gets its turn even when one
 * fails, and the injected fetch reaches the service unchanged.
 */
const makeContainer = (
  ingestSource: (source: string, deps: unknown) => Promise<IngestOutcome>
) => {
  const resolve = jest.fn((key: string) => {
    // The real awilix container throws on an unknown key; a stub that returned
    // something for any string would let a wrong key pass silently.
    if (key !== IRS_EXEMPT_ORG_MODULE) throw new Error(`Could not resolve '${key}'`)
    return { ingestSource }
  })
  return { container: { resolve } as never, resolve }
}

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
