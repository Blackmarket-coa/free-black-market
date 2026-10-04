import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { moduleIntegrationTestRunner } from "@medusajs/test-utils"
import { IRS_EXEMPT_ORG_MODULE } from "../module-key"
import IrsExemptOrgModuleService, { type FetchToFile } from "../service"
import { IrsExemptOrg, IrsIngestSnapshot, IrsPub78Listing, IrsRevocation } from "../models"
import { IRS_SOURCE_URLS } from "../sources"

const fixture = (name: string) => path.join(__dirname, "fixtures", name)

const PUB78_LM = new Date("2026-09-10T09:18:37Z")
const REVOCATION_LM = new Date("2026-09-30T09:14:54Z")
const BMF_LM = new Date("2026-09-07T04:13:27Z")

const BMF_HEADER =
  "EIN,NAME,ICO,STREET,CITY,STATE,ZIP,GROUP,SUBSECTION,AFFILIATION,CLASSIFICATION,RULING,DEDUCTIBILITY,FOUNDATION,ACTIVITY,ORGANIZATION,STATUS,TAX_PERIOD,ASSET_CD,INCOME_CD,FILING_REQ_CD,PF_FILING_REQ_CD,ACCT_PD,ASSET_AMT,INCOME_AMT,REVENUE_AMT,NTEE_CD,SORT_NAME\n"

/**
 * A fetch that serves the fixtures as the IRS would: Pub 78 and the
 * revocation list as zips, the BMF as five CSVs (the sample in `eo_xx`, a
 * header-only file for eo1–eo4). `etags` lets a test answer 304.
 */
function fixtureFetch(opts: { unchanged?: boolean; corruptPub78?: boolean; pub78File?: string } = {}): FetchToFile {
  return async (url, { destPath, ifNoneMatch }) => {
    if (opts.unchanged && ifNoneMatch) {
      return { status: 304, lastModified: null, etag: ifNoneMatch, sha256: null, bytes: 0 }
    }
    if (url === IRS_SOURCE_URLS.pub78[0]) {
      if (opts.corruptPub78) {
        await fs.writeFile(destPath, "<html>maintenance page served with a 200</html>")
        return { status: 200, lastModified: new Date("2026-10-01T00:00:00Z"), etag: '"p78-broken"', sha256: "x", bytes: 1 }
      }
      await fs.copyFile(fixture(opts.pub78File ?? "pub78-sample.zip"), destPath)
      return { status: 200, lastModified: PUB78_LM, etag: '"p78-1"', sha256: "p78", bytes: 1 }
    }
    if (url === IRS_SOURCE_URLS.revocation[0]) {
      await fs.copyFile(fixture("revocation-sample.zip"), destPath)
      return { status: 200, lastModified: REVOCATION_LM, etag: '"rev-1"', sha256: "rev", bytes: 1 }
    }
    if (url.endsWith("eo_xx.csv")) {
      await fs.copyFile(fixture("eo-bmf-sample.csv"), destPath)
      return { status: 200, lastModified: BMF_LM, etag: '"bmf-xx"', sha256: "bmf", bytes: 1 }
    }
    await fs.writeFile(destPath, BMF_HEADER)
    return { status: 200, lastModified: BMF_LM, etag: `"bmf-${path.basename(url)}"`, sha256: "hdr", bytes: 1 }
  }
}

/**
 * Real-Postgres coverage for the ingest and the lookup.
 *
 * Three things a stubbed connection cannot show: that the batched upsert and
 * the TRUNCATE/INSERT…SELECT swap produce rows the ORM-backed lookup actually
 * finds; that every lookup state carries the as-of date of the file it came
 * from; and that a failed second run leaves the first snapshot — rows and
 * date — exactly as it was.
 *
 * Requires a database — run with:
 *   TEST_TYPE=integration:modules pnpm test:integration:modules \
 *     src/modules/irs-exempt-org/__tests__/irs-exempt-org.integration.spec.ts
 *
 * Intentionally NOT a *.unit.spec.ts so the DB-less unit suite skips it.
 */
moduleIntegrationTestRunner<IrsExemptOrgModuleService>({
  moduleName: IRS_EXEMPT_ORG_MODULE,
  resolve: "./src/modules/irs-exempt-org",
  moduleModels: [IrsExemptOrg, IrsPub78Listing, IrsRevocation, IrsIngestSnapshot],
  testSuite: ({ service }) => {
    let tmpDir: string
    beforeAll(async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "irs-integration-"))
    })
    afterAll(async () => {
      await fs.rm(tmpDir, { recursive: true, force: true })
    })

    const ingestAll = async (fetchToFile: FetchToFile) => ({
      pub78: await service.ingestSource("pub78", { fetchToFile, tmpDir }),
      revocation: await service.ingestSource("revocation", { fetchToFile, tmpDir }),
      eo_bmf: await service.ingestSource("eo_bmf", { fetchToFile, tmpDir }),
    })

    describe("first load", () => {
      it("loads all three sources through staging and records a per-source snapshot", async () => {
        const out = await ingestAll(fixtureFetch())
        expect(out.pub78).toEqual({ source: "pub78", outcome: "ingested", row_count: 50, as_of: PUB78_LM })
        expect(out.revocation).toEqual({ source: "revocation", outcome: "ingested", row_count: 50, as_of: REVOCATION_LM })
        expect(out.eo_bmf).toEqual({ source: "eo_bmf", outcome: "ingested", row_count: 50, as_of: BMF_LM })

        const snapshots = await service.getSnapshots()
        expect(snapshots.pub78).toMatchObject({ status: "complete", row_count: 50, etag: '"p78-1"' })
        expect(new Date(snapshots.pub78!.as_of as Date)).toEqual(PUB78_LM)
        expect(new Date(snapshots.revocation!.as_of as Date)).toEqual(REVOCATION_LM)
        expect(new Date(snapshots.eo_bmf!.as_of as Date)).toEqual(BMF_LM)
        expect(snapshots.eo_bmf!.metadata?.files).toBeDefined()
        expect(Object.keys(snapshots.eo_bmf!.metadata!.files!)).toHaveLength(5)

        expect(await service.listIrsExemptOrgs({})).toHaveLength(50)
        expect(await service.listIrsPub78Listings({})).toHaveLength(50)
        expect(await service.listIrsRevocations({})).toHaveLength(50)
      })

      it("answers all four lookup states, each with its own source's as-of date", async () => {
        await ingestAll(fixtureFetch())

        // In the BMF only (a 501(c)(5)): no Pub 78 listing, no revocation.
        const bmfOnly = await service.lookupEin("061291614")
        expect(bmfOnly).toEqual({ state: "bmf_only", ein: "061291614", subsection: "05", status: "01", as_of: BMF_LM })

        // Listed in Pub 78 (as a foreign org), also in the BMF (subsection
        // comes from there), with a 2014 revocation older than the Pub 78 file.
        const listed = await service.lookupEin("03-0424472")
        expect(listed).toEqual({
          state: "pub78_eligible",
          ein: "030424472",
          deductibility_codes: ["FORGN"],
          subsection: "03",
          subsection_as_of: BMF_LM,
          as_of: PUB78_LM,
        })

        // Listed in Pub 78 only (not in this BMF sample): subsection null, not invented.
        const pub78Only = await service.lookupEin("000587764")
        expect(pub78Only).toMatchObject({ state: "pub78_eligible", subsection: null, subsection_as_of: BMF_LM, as_of: PUB78_LM })

        // Revoked 2011, never reinstated, not in Pub 78.
        const revoked = await service.lookupEin("260089814")
        expect(revoked).toEqual({
          state: "revoked",
          ein: "260089814",
          revoked_on: new Date("2010-11-15T00:00:00Z"),
          posted_on: new Date("2011-07-13T00:00:00Z"),
          exemption_type: "07",
          as_of: REVOCATION_LM,
        })

        // Reinstated: the revocation is history, the BMF row is the status.
        const reinstated = await service.lookupEin("237069639")
        expect(reinstated).toMatchObject({ state: "bmf_only", subsection: "03", as_of: BMF_LM })

        // Revocation posted 29-SEP-2026, after the Pub 78 file of 10-SEP: revoked wins.
        const newerRevocation = await service.lookupEin("061681646")
        expect(newerRevocation).toMatchObject({
          state: "revoked",
          posted_on: new Date("2026-09-29T00:00:00Z"),
          as_of: REVOCATION_LM,
        })

        // Two revocation rows; the 2018 one stands, but Pub 78 (2026) is newer and lists it.
        const twice = await service.lookupEin("200644142")
        expect(twice).toMatchObject({ state: "pub78_eligible", as_of: PUB78_LM })

        // Nowhere: not_found, with the newest file date and every source's date.
        const missing = await service.lookupEin("12-3456789")
        expect(missing).toEqual({
          state: "not_found",
          ein: "123456789",
          as_of: REVOCATION_LM,
          sources_as_of: { pub78: PUB78_LM, revocation: REVOCATION_LM, eo_bmf: BMF_LM },
        })
      })

      it("stores no ICO/STREET and nothing but the retained columns", async () => {
        await ingestAll(fixtureFetch())
        const [row] = await service.listIrsExemptOrgs({ ein: "260089814" })
        expect(row).not.toHaveProperty("ico")
        expect(row).not.toHaveProperty("street")
        expect(row).toMatchObject({ name: "SIGMA GAMMA RHO SORORITY INC", subsection: "07", ntee_cd: "B83" })
      })
    })

    describe("second run", () => {
      it("304 on every file skips the load and changes nothing", async () => {
        await ingestAll(fixtureFetch())
        const before = await service.getSnapshots()
        const out = await ingestAll(fixtureFetch({ unchanged: true }))
        expect(out.pub78).toEqual({ source: "pub78", outcome: "skipped_unchanged", as_of: PUB78_LM })
        expect(out.revocation.outcome).toBe("skipped_unchanged")
        expect(out.eo_bmf.outcome).toBe("skipped_unchanged")
        const after = await service.getSnapshots()
        expect(new Date(after.pub78!.as_of as Date)).toEqual(new Date(before.pub78!.as_of as Date))
        expect(after.pub78!.status).toBe("complete")
        expect(after.pub78!.metadata?.last_outcome).toBe("unchanged")
        expect(await service.listIrsPub78Listings({})).toHaveLength(50)
      })

      it("a failed run leaves the previous snapshot visible: rows, as_of and lookups unchanged", async () => {
        await ingestAll(fixtureFetch())
        const out = await service.ingestSource("pub78", { fetchToFile: fixtureFetch({ corruptPub78: true }), tmpDir })
        expect(out).toMatchObject({ source: "pub78", outcome: "failed" })
        expect((out as { error: string }).error).toMatch(/zip/)

        const snapshot = (await service.getSnapshots()).pub78!
        expect(snapshot.status).toBe("failed")
        expect(snapshot.error).toMatch(/zip/)
        expect(new Date(snapshot.as_of as Date)).toEqual(PUB78_LM)
        expect(snapshot.etag).toBe('"p78-1"')
        expect(snapshot.row_count).toBe(50)

        expect(await service.listIrsPub78Listings({})).toHaveLength(50)
        const listed = await service.lookupEin("030424472")
        expect(listed).toMatchObject({ state: "pub78_eligible", as_of: PUB78_LM })

        // The next run still sends the validators of the data that is live,
        // not of the file that failed to load.
        const seen: Array<string | null | undefined> = []
        await service.ingestSource("pub78", {
          fetchToFile: async (url, o) => {
            seen.push(o.ifNoneMatch)
            return fixtureFetch({ unchanged: true })(url, o)
          },
          tmpDir,
        })
        expect(seen).toEqual(['"p78-1"'])
      })

      it("a changed file replaces the live rows wholesale", async () => {
        await ingestAll(fixtureFetch())
        expect((await service.lookupEin("030424472")).state).toBe("pub78_eligible")

        // A Pub 78 file that no longer lists 030424472 (the two-entry fixture
        // zip stands in: its first entry is not a Pub 78 file, so zero rows).
        const dropped: FetchToFile = async (url, o) => {
          await fs.copyFile(fixture("two-entries.zip"), o.destPath)
          void url
          return { status: 200, lastModified: new Date("2026-10-13T09:00:00Z"), etag: '"p78-2"', sha256: "p2", bytes: 1 }
        }
        const out = await service.ingestSource("pub78", { fetchToFile: dropped, tmpDir })
        expect(out).toEqual({ source: "pub78", outcome: "ingested", row_count: 0, as_of: new Date("2026-10-13T09:00:00Z") })
        expect(await service.listIrsPub78Listings({})).toHaveLength(0)
        // Still in the BMF and revocation list (posted 2014, older than the new
        // Pub 78 date, but with no Pub 78 listing left the revocation stands).
        const now = await service.lookupEin("030424472")
        expect(now).toMatchObject({ state: "revoked", exemption_type: "00", as_of: REVOCATION_LM })
        const stillBmf = await service.lookupEin("061291614")
        expect(stillBmf).toMatchObject({ state: "bmf_only", as_of: BMF_LM })
      })
    })
  },
})
