import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import IrsExemptOrgModuleService, {
  type FetchToFile,
  type FetchToFileResult,
  type PgLike,
  type PgRaw,
} from "../service"
import { IRS_SOURCE_URLS } from "../sources"

const fixture = (name: string) => path.join(__dirname, "fixtures", name)

const PUB78_LM = new Date("2026-09-10T09:18:37Z")
const BMF_LM = new Date("2026-09-07T04:13:27Z")

type Call = { sql: string; bindings: unknown[]; inTx: boolean }

/**
 * A knex stand-in that records every statement. The snapshot row is the one
 * piece of state the ingest reads back, so it is simulated just far enough
 * for the conditional-GET headers on a second run to be observable.
 */
function makePg(opts: { snapshot?: Record<string, unknown> | null } = {}) {
  const calls: Call[] = []
  let snapshot = opts.snapshot ?? null
  const recorder = (inTx: boolean): PgRaw => ({
    raw: async (sql: string, bindings: unknown[] = []) => {
      calls.push({ sql: sql.replace(/\s+/g, " ").trim(), bindings, inTx })
      if (/^SELECT .* FROM irs_ingest_snapshot/i.test(sql.replace(/\s+/g, " "))) {
        return { rows: snapshot ? [snapshot] : [] }
      }
      if (/INSERT INTO irs_ingest_snapshot/i.test(sql)) {
        snapshot = { ...(snapshot ?? {}), source: bindings[1], status: "pending", started_at: bindings[2] }
      }
      return { rows: [] }
    },
  })
  const pg: PgLike = {
    ...recorder(false),
    transaction: async (fn) => {
      calls.push({ sql: "BEGIN", bindings: [], inTx: true })
      const out = await fn(recorder(true))
      calls.push({ sql: "COMMIT", bindings: [], inTx: true })
      return out
    },
  }
  return { pg, calls, getSnapshot: () => snapshot }
}

const copyFixture =
  (name: string, result: Partial<FetchToFileResult> = {}): FetchToFile =>
  async (_url, opts) => {
    await fs.copyFile(fixture(name), opts.destPath)
    return { status: 200, lastModified: PUB78_LM, etag: '"etag-1"', sha256: "abc", bytes: 1, ...result }
  }

const notModified: FetchToFile = async () => ({
  status: 304,
  lastModified: null,
  etag: null,
  sha256: null,
  bytes: 0,
})

const service = () => Object.create(IrsExemptOrgModuleService.prototype) as IrsExemptOrgModuleService

const sqlOf = (calls: Call[]) => calls.map((c) => c.sql)

/** A completed snapshot as the service itself writes one: validators per URL in `metadata.files`. */
const completedSnapshot = (source: "pub78" | "revocation", asOf: Date, etag: string) => {
  const url = IRS_SOURCE_URLS[source][0]
  return {
    source,
    as_of: asOf,
    etag,
    status: "complete",
    metadata: { files: { [url]: { etag, last_modified: asOf.toISOString() } } },
  }
}

/**
 * Stands in for the module's awilix cradle: every property read is a resolve,
 * and an unregistered name throws. In particular `cradle.resolve` throws, so
 * an accessor that tries `.resolve?.()` before the property read never finds
 * the registered connection.
 */
const cradleWith = (registrations: Record<string, unknown>) =>
  new Proxy(registrations, {
    get(target, name) {
      if (typeof name === "string" && name in target) return target[name]
      throw new Error(`AwilixResolutionError: Could not resolve '${String(name)}'.`)
    },
  })

describe("IrsExemptOrgModuleService.resolvePgConnection", () => {
  const knexLike = (): PgLike => ({ raw: async () => ({ rows: [] }), transaction: async (fn) => fn({ raw: async () => ({ rows: [] }) }) })

  it("reads PG_CONNECTION as a property of the cradle, before trying .resolve()", () => {
    const pg = knexLike()
    const svc = service() as unknown as { __container__: unknown; resolvePgConnection: () => PgLike | undefined }
    svc.__container__ = cradleWith({ [ContainerRegistrationKeys.PG_CONNECTION]: pg })
    expect(svc.resolvePgConnection()).toBe(pg)
  })

  it("falls back to a real container's .resolve() when the property read finds nothing", () => {
    const pg = knexLike()
    const resolve = jest.fn((key: string) => {
      if (key !== ContainerRegistrationKeys.PG_CONNECTION) throw new Error(`Could not resolve '${key}'`)
      return pg
    })
    const svc = service() as unknown as { __container__: unknown; resolvePgConnection: () => PgLike | undefined }
    svc.__container__ = { resolve }
    expect(svc.resolvePgConnection()).toBe(pg)
    expect(resolve).toHaveBeenCalledWith(ContainerRegistrationKeys.PG_CONNECTION)
  })

  it("uses the EntityManager's knex when the cradle registers no connection (the module test harness)", () => {
    const pg = knexLike()
    const svc = service() as unknown as {
      __container__: unknown
      baseRepository_: unknown
      resolvePgConnection: () => PgLike | undefined
    }
    svc.__container__ = cradleWith({})
    svc.baseRepository_ = { getActiveManager: () => ({ getConnection: () => ({ getKnex: () => pg }) }) }
    expect(svc.resolvePgConnection()).toBe(pg)
  })

  it("is undefined with no container at all", () => {
    expect(service().resolvePgConnection()).toBeUndefined()
  })
})

describe("IrsExemptOrgModuleService.ingestSource", () => {
  let tmpDir: string
  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "irs-ingest-spec-"))
  })
  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it("refuses to run without a database connection", async () => {
    await expect(
      service().ingestSource("pub78", { fetchToFile: notModified, tmpDir })
    ).rejects.toThrow(/no database connection/)
  })

  it("304 on every file: marks the attempt complete-unchanged and never touches the tables", async () => {
    const { pg, calls } = makePg({ snapshot: completedSnapshot("pub78", PUB78_LM, '"etag-1"') })
    const fetchToFile = jest.fn(notModified)
    const out = await service().ingestSource("pub78", { fetchToFile, pg, tmpDir })

    expect(out).toEqual({ source: "pub78", outcome: "skipped_unchanged", as_of: PUB78_LM })
    expect(fetchToFile).toHaveBeenCalledTimes(1)
    const sql = sqlOf(calls)
    expect(sql.some((s) => /TRUNCATE/.test(s))).toBe(false)
    expect(sql.some((s) => /INSERT INTO "irs_pub78_listing/.test(s))).toBe(false)
    expect(calls.some((c) => c.inTx)).toBe(false)
    const unchanged = calls.find((c) => /SET status = 'complete'/.test(c.sql))
    expect(unchanged).toBeDefined()
    expect(unchanged?.sql).not.toMatch(/as_of =/)
  })

  it("first ever run: a 304 to a request that sent no validators is a failure, not 'unchanged'", async () => {
    const { pg, calls } = makePg()
    const fetchToFile = jest.fn(notModified)
    const out = await service().ingestSource("pub78", { fetchToFile, pg, tmpDir })

    expect(fetchToFile).toHaveBeenCalledWith(
      IRS_SOURCE_URLS.pub78[0],
      expect.objectContaining({ ifNoneMatch: null, ifModifiedSince: null })
    )
    expect(out).toMatchObject({ source: "pub78", outcome: "failed" })
    expect((out as { error: string }).error).toMatch(/304 to an unconditional request/)
    const sql = sqlOf(calls)
    expect(sql.some((s) => /SET status = 'complete'/.test(s))).toBe(false)
    expect(sql.some((s) => /SET status = 'failed'/.test(s))).toBe(true)
    expect(sql.some((s) => /TRUNCATE/.test(s))).toBe(false)
  })

  it("sends the previous file's etag and last-modified as conditional headers", async () => {
    const url = IRS_SOURCE_URLS.pub78[0]
    const { pg } = makePg({
      snapshot: {
        source: "pub78",
        as_of: PUB78_LM,
        etag: '"etag-1"',
        status: "complete",
        metadata: { files: { [url]: { etag: '"etag-1"', last_modified: PUB78_LM.toISOString() } } },
      },
    })
    const fetchToFile = jest.fn(notModified)
    await service().ingestSource("pub78", { fetchToFile, pg, tmpDir })
    expect(fetchToFile).toHaveBeenCalledWith(
      url,
      expect.objectContaining({ ifNoneMatch: '"etag-1"', ifModifiedSince: PUB78_LM })
    )
    expect((fetchToFile.mock.calls[0][1] as { destPath: string }).destPath.startsWith(tmpDir)).toBe(true)
  })

  it("200: batches the zip's rows into staging, then swaps live and the snapshot in one transaction", async () => {
    const { pg, calls } = makePg()
    const out = await service().ingestSource("pub78", {
      fetchToFile: copyFixture("pub78-sample.zip"),
      pg,
      tmpDir,
      batchSize: 20,
    })

    expect(out).toEqual({ source: "pub78", outcome: "ingested", row_count: 50, as_of: PUB78_LM })

    const sql = sqlOf(calls)
    // Attempt bookkeeping first, before any download.
    expect(sql[0]).toMatch(/^SELECT .* FROM irs_ingest_snapshot/)
    expect(sql[1]).toMatch(/INSERT INTO irs_ingest_snapshot .* 'pending'/)

    // The service owns its staging table: idempotent DDL runs before the first
    // TRUNCATE (the module test harness builds the schema from the models, so
    // the migration's UNLOGGED twin is not there). Then three batches (20 +
    // 20 + 10) of seven columns.
    const createTable = calls.findIndex((c) => c.sql === 'CREATE UNLOGGED TABLE IF NOT EXISTS "irs_pub78_listing_staging" (LIKE "irs_pub78_listing" INCLUDING DEFAULTS)')
    const createIndex = calls.findIndex((c) => c.sql === 'CREATE UNIQUE INDEX IF NOT EXISTS "UQ_irs_pub78_listing_staging_ein" ON "irs_pub78_listing_staging" ("ein")')
    const firstTruncate = calls.findIndex((c) => c.sql === 'TRUNCATE "irs_pub78_listing_staging"')
    expect(createTable).toBeGreaterThan(-1)
    expect(createIndex).toBeGreaterThan(createTable)
    expect(firstTruncate).toBeGreaterThan(createIndex)
    expect(calls[createTable].inTx).toBe(false)
    const stagingTruncates = calls.filter((c) => c.sql === 'TRUNCATE "irs_pub78_listing_staging"')
    expect(stagingTruncates).toHaveLength(2) // before load, and after the swap
    const batches = calls.filter((c) => /INSERT INTO "irs_pub78_listing_staging"/.test(c.sql))
    expect(batches.map((b) => b.bindings.length)).toEqual([20 * 7, 20 * 7, 10 * 7])
    expect(batches.every((b) => !b.inTx)).toBe(true)
    expect(batches[0].sql).toMatch(/ON CONFLICT \("ein"\) DO UPDATE/)
    expect(batches[0].bindings.slice(0, 2)).toEqual(["irsp78_030424472", "030424472"])

    // The swap: TRUNCATE live + INSERT…SELECT + snapshot complete, all inside the transaction.
    const tx = calls.filter((c) => c.inTx).map((c) => c.sql)
    expect(tx[0]).toBe("BEGIN")
    expect(tx[1]).toBe('TRUNCATE "irs_pub78_listing"')
    expect(tx[2]).toMatch(/^INSERT INTO "irs_pub78_listing" \(.*\) SELECT .* FROM "irs_pub78_listing_staging"$/)
    expect(tx[3]).toMatch(/UPDATE irs_ingest_snapshot SET status = 'complete', as_of = \?/)
    expect(tx[4]).toBe("COMMIT")
    const snapshotWrite = calls.find((c) => c.inTx && /status = 'complete'/.test(c.sql))
    expect(snapshotWrite?.bindings[0]).toEqual(PUB78_LM)
    expect(snapshotWrite?.bindings[3]).toBe(50)
    const metadata = JSON.parse(snapshotWrite?.bindings[5] as string)
    expect(metadata.files[IRS_SOURCE_URLS.pub78[0]]).toEqual({ etag: '"etag-1"', last_modified: PUB78_LM.toISOString() })

    // Nothing live is touched outside the transaction. The staging DDL names
    // the live table in its LIKE clause (it reads the definition, not rows).
    expect(
      calls.filter((c) => !c.inTx && !/^CREATE /.test(c.sql) && /"irs_pub78_listing"/.test(c.sql))
    ).toHaveLength(0)
  })

  it("revocation rows are keyed per event so repeated EINs are kept", async () => {
    const { pg, calls } = makePg()
    const out = await service().ingestSource("revocation", {
      fetchToFile: copyFixture("revocation-sample.zip", { lastModified: new Date("2026-09-30T09:14:54Z") }),
      pg,
      tmpDir,
    })
    expect(out).toMatchObject({ outcome: "ingested", row_count: 50 })
    // The conflict target is the primary key, so the index the service ensures
    // carries the PK's backing-index name: a no-op where the migration ran.
    expect(sqlOf(calls)).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "irs_revocation_staging_pkey" ON "irs_revocation_staging" ("id")'
    )
    const batch = calls.find((c) => /INSERT INTO "irs_revocation_staging"/.test(c.sql))
    expect(batch?.sql).toMatch(/ON CONFLICT \("id"\) DO NOTHING/)
    const ids = (batch?.bindings ?? []).filter((b, i) => i % 11 === 0) as string[]
    expect(ids.filter((id) => id.startsWith("irsrev_200644142_"))).toHaveLength(2)
    expect(ids.filter((id) => id.startsWith("irsrev_061681646_"))).toEqual(
      expect.arrayContaining(["irsrev_061681646_20260929_20240515"])
    )
  })

  it("EO BMF: five URLs, one snapshot; a 304 part is re-fetched when another part changed", async () => {
    const { pg, calls } = makePg()
    const headerOnly =
      "EIN,NAME,ICO,STREET,CITY,STATE,ZIP,GROUP,SUBSECTION,AFFILIATION,CLASSIFICATION,RULING,DEDUCTIBILITY,FOUNDATION,ACTIVITY,ORGANIZATION,STATUS,TAX_PERIOD,ASSET_CD,INCOME_CD,FILING_REQ_CD,PF_FILING_REQ_CD,ACCT_PD,ASSET_AMT,INCOME_AMT,REVENUE_AMT,NTEE_CD,SORT_NAME\n"
    const seen: Array<{ url: string; conditional: boolean }> = []
    const fetchToFile: FetchToFile = async (url, opts) => {
      const conditional = !!opts.ifNoneMatch || !!opts.ifModifiedSince
      seen.push({ url, conditional })
      if (url.endsWith("eo_xx.csv")) {
        await fs.copyFile(fixture("eo-bmf-sample.csv"), opts.destPath)
        return { status: 200, lastModified: BMF_LM, etag: '"xx"', sha256: "h5", bytes: 1 }
      }
      if (conditional) return { status: 304, lastModified: null, etag: null, sha256: null, bytes: 0 }
      await fs.writeFile(opts.destPath, headerOnly)
      return { status: 200, lastModified: new Date("2026-09-06T00:00:00Z"), etag: '"h"', sha256: "h1", bytes: 1 }
    }
    const url0 = IRS_SOURCE_URLS.eo_bmf[0]
    const snapshotWithEtags = {
      source: "eo_bmf",
      status: "complete",
      as_of: new Date("2026-08-01T00:00:00Z"),
      metadata: {
        files: Object.fromEntries(
          IRS_SOURCE_URLS.eo_bmf.map((u) => [u, { etag: '"old"', last_modified: "2026-08-01T00:00:00.000Z" }])
        ),
      },
    }
    const { pg: pg2, calls: calls2 } = makePg({ snapshot: snapshotWithEtags })
    void pg
    void calls
    const out = await service().ingestSource("eo_bmf", { fetchToFile, pg: pg2, tmpDir })

    expect(out).toEqual({ source: "eo_bmf", outcome: "ingested", row_count: 50, as_of: BMF_LM })
    // 5 conditional requests, then 4 unconditional re-fetches of the 304 parts.
    expect(seen.filter((s) => s.conditional)).toHaveLength(5)
    expect(seen.filter((s) => !s.conditional).map((s) => s.url)).toEqual(IRS_SOURCE_URLS.eo_bmf.slice(0, 4))
    expect(seen.some((s) => s.url === url0)).toBe(true)
    const batch = calls2.find((c) => /INSERT INTO "irs_exempt_org_staging"/.test(c.sql))
    expect(batch?.bindings.length).toBe(50 * 14)
    // No ICO/STREET anywhere in what is written.
    expect(batch?.sql).not.toMatch(/ico|street/i)
    const tx = calls2.filter((c) => c.inTx).map((c) => c.sql)
    expect(tx).toContain('TRUNCATE "irs_exempt_org"')
    expect(sqlOf(calls2)).toContain(
      'CREATE UNLOGGED TABLE IF NOT EXISTS "irs_exempt_org_staging" (LIKE "irs_exempt_org" INCLUDING DEFAULTS)'
    )
  })

  it("a duplicate EIN inside one batch is collapsed to a single row before the INSERT, last row winning", async () => {
    const { pg, calls } = makePg()
    const header =
      "EIN,NAME,ICO,STREET,CITY,STATE,ZIP,GROUP,SUBSECTION,AFFILIATION,CLASSIFICATION,RULING,DEDUCTIBILITY,FOUNDATION,ACTIVITY,ORGANIZATION,STATUS,TAX_PERIOD,ASSET_CD,INCOME_CD,FILING_REQ_CD,PF_FILING_REQ_CD,ACCT_PD,ASSET_AMT,INCOME_AMT,REVENUE_AMT,NTEE_CD,SORT_NAME\n"
    const row = (name: string, status: string) =>
      `010728628,${name},,,PAGO PAGO,AS,96799,0000,03,3,1000,200211,1,15,000000000,1,${status},202412,0,0,02,0,12,0,0,0,O50,\n`
    const other = "000019818,SOME OTHER ORG,,,TOWN,ME,04101,0000,03,3,1000,199001,1,15,000000000,1,01,202412,0,0,02,0,12,0,0,0,A20,\n"
    const fetchToFile: FetchToFile = async (url, opts) => {
      // One CSV holds the duplicate; the other four parts are header-only.
      const body = url.endsWith("eo_xx.csv") ? header + row("FIRST SPELLING", "01") + other + row("LAST SPELLING", "02") : header
      await fs.writeFile(opts.destPath, body)
      return { status: 200, lastModified: BMF_LM, etag: '"d"', sha256: "d", bytes: body.length }
    }
    const out = await service().ingestSource("eo_bmf", { fetchToFile, pg, tmpDir, batchSize: 2_000 })

    // Three parsed rows, two distinct EINs: a single multi-row INSERT with two tuples.
    expect(out).toEqual({ source: "eo_bmf", outcome: "ingested", row_count: 2, as_of: BMF_LM })
    const batches = calls.filter((c) => /INSERT INTO "irs_exempt_org_staging"/.test(c.sql))
    expect(batches).toHaveLength(1)
    expect(batches[0].bindings).toHaveLength(2 * 14)
    const eins = batches[0].bindings.filter((_b, i) => i % 14 === 1)
    expect(eins).toEqual(["010728628", "000019818"])
    // The later row's values are the ones kept.
    expect(batches[0].bindings.slice(0, 14)).toEqual(
      expect.arrayContaining(["irsorg_010728628", "010728628", "LAST SPELLING", "02"])
    )
    expect(batches[0].bindings).not.toContain("FIRST SPELLING")
  })

  it("a corrupt file fails the run, marks the snapshot failed and leaves as_of and live rows alone", async () => {
    const { pg, calls } = makePg({
      snapshot: { source: "pub78", as_of: PUB78_LM, etag: '"etag-1"', status: "complete", metadata: null },
    })
    const fetchToFile: FetchToFile = async (_url, opts) => {
      await fs.writeFile(opts.destPath, "this is not a zip archive\r\n")
      return { status: 200, lastModified: new Date("2026-10-01T00:00:00Z"), etag: '"etag-2"', sha256: "x", bytes: 1 }
    }
    const out = await service().ingestSource("pub78", { fetchToFile, pg, tmpDir })

    expect(out).toMatchObject({ source: "pub78", outcome: "failed" })
    expect((out as { error: string }).error).toMatch(/zip/)
    expect(calls.some((c) => c.inTx)).toBe(false)
    expect(sqlOf(calls)).not.toContain('TRUNCATE "irs_pub78_listing"')
    const failed = calls.find((c) => /SET status = 'failed'/.test(c.sql))
    expect(failed).toBeDefined()
    expect(failed?.sql).not.toMatch(/as_of|etag/)
    expect(failed?.bindings[2]).toBe("pub78")
  })

  it("cleans up its temp directory on both paths", async () => {
    const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "irs-tmp-check-"))
    try {
      const { pg } = makePg()
      await service().ingestSource("pub78", { fetchToFile: copyFixture("pub78-sample.zip"), pg, tmpDir: scratch })
      const { pg: pg2 } = makePg()
      await service().ingestSource("pub78", {
        fetchToFile: async (_u, o) => {
          await fs.writeFile(o.destPath, "nope")
          return { status: 200, lastModified: null, etag: null, sha256: null, bytes: 4 }
        },
        pg: pg2,
        tmpDir: scratch,
      })
      expect(await fs.readdir(scratch)).toEqual([])
    } finally {
      await fs.rm(scratch, { recursive: true, force: true })
    }
  })
})
