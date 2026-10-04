import * as fs from "fs"
import * as path from "path"
import { POST as VERIFY } from "../[key]/verify/route"
import { IRS_EXEMPT_ORG_MODULE } from "../../../../../modules/irs-exempt-org/module-key"
import type { IrsLookupResult } from "../../../../../modules/irs-exempt-org/lookup"
import { PARTNER_DIRECTORY_MODULE, PARTNER_ORG_VERIFICATION_FIELDS } from "../../../../../modules/partner-directory"
import { IRS_BULK_FILE_SOURCE } from "../../../../../modules/partner-directory/service"
import { PHASE0_FEATURE_FLAGS } from "../../../../../shared/feature-flags"
import {
  makeInMemoryDirectory,
  type InMemoryDirectory,
  type OrgRow,
} from "../../../../../modules/partner-directory/__tests__/in-memory-partner-orgs"

/**
 * `POST /admin/partners/orgs/:key/verify` is the admin's only way to change
 * verification, and it still cannot choose the answer. Against the REAL
 * partner-directory service (prototype + shadowed CRUD) and a fake IRS
 * module keyed on the imported constant:
 *
 * - dark with the flag off; neither module is resolved;
 * - a status in the body is a 400 that names it, and nothing is looked up;
 * - the status written is the lookup's, dated by the file, sourced
 *   `irs_bulk_file`, and the response says whether a publish was pulled;
 * - an `ein` override is normalised and stored before the lookup;
 * - both modules are resolved by their imported constants, and a near-miss
 *   key makes the route throw rather than pass.
 */
const FLAG = PHASE0_FEATURE_FLAGS.NONPROFIT_PARITY_V1
const EIN = "123456789"
const PUB78_AS_OF = new Date("2026-09-10T09:18:37Z")
const REVOCATION_AS_OF = new Date("2026-09-30T09:14:54Z")

type TestRes = {
  statusCode: number
  body: Record<string, unknown>
  status: (code: number) => TestRes
  json: (payload: unknown) => TestRes
}

const createRes = (): TestRes => {
  const res = { statusCode: 200, body: {} } as TestRes
  res.status = (code: number) => {
    res.statusCode = code
    return res
  }
  res.json = (payload: unknown) => {
    res.body = payload as Record<string, unknown>
    return res
  }
  return res
}

type Req = Parameters<typeof VERIFY>[0]
type Res = Parameters<typeof VERIFY>[1]

type LookupFn = (ein: string) => IrsLookupResult | Promise<IrsLookupResult>

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

function makeScope(dir: InMemoryDirectory, lookupEin: LookupFn, keys: { directory?: string; irs?: string } = {}) {
  const resolved: string[] = []
  const directoryKey = keys.directory ?? PARTNER_DIRECTORY_MODULE
  const irsKey = keys.irs ?? IRS_EXEMPT_ORG_MODULE
  const irs = { lookupEin: jest.fn(async (ein: string): Promise<IrsLookupResult> => lookupEin(ein)) }
  return {
    resolved,
    irs,
    scope: {
      resolve: (key: string) => {
        resolved.push(key)
        if (key === directoryKey) return dir.service
        if (key === irsKey) return irs
        // awilix throws on an unknown key; a fallback here would let a wrong
        // constant pass silently (CLAUDE.md rule 2).
        throw new Error(`Could not resolve '${key}'`)
      },
    },
  }
}

async function call(
  dir: InMemoryDirectory,
  opts: {
    key?: string
    body?: unknown
    lookupEin?: LookupFn
    keys?: { directory?: string; irs?: string }
  } = {}
) {
  const { scope, resolved, irs } = makeScope(dir, opts.lookupEin ?? pub78For, opts.keys)
  const res = createRes()
  const req = { body: opts.body, params: opts.key ? { key: opts.key } : {}, scope } as unknown as Req
  await VERIFY(req, res as unknown as Res)
  return { res, resolved, irs }
}

const unverified501c3 = (overrides: Partial<OrgRow> = {}): Partial<OrgRow> & { key: string; name: string } => ({
  key: "example_501c3",
  name: "Example 501(c)(3)",
  org_type: "irs_501c3",
  ein: EIN,
  ...overrides,
})

afterEach(() => {
  delete process.env[FLAG]
})

describe("POST /admin/partners/orgs/:key/verify — flag off", () => {
  it("answers 404 feature_disabled and resolves neither module", async () => {
    const dir = makeInMemoryDirectory([unverified501c3()])
    const { res, resolved, irs } = await call(dir, { key: "example_501c3", body: {} })
    expect(res.statusCode).toBe(404)
    expect(res.body).toMatchObject({ type: "feature_disabled" })
    expect(resolved).toEqual([])
    expect(irs.lookupEin).not.toHaveBeenCalled()
    expect(dir.calls.update).toEqual([])
  })

  it("is covered by the /admin/partners/orgs* matcher behind user auth and the flag gate", () => {
    const source = fs.readFileSync(path.resolve(__dirname, "../../../../middlewares.ts"), "utf8")
    const block = source.split(/\n\s*\{\s*\n/).find((b) => b.includes('matcher: "/admin/partners/orgs*"'))
    expect(block).toBeDefined()
    expect(block).toContain('authenticate("user"')
    expect(block).toContain('requireFeatureFlagMiddleware("NONPROFIT_PARITY_V1")')

    // Express 4's `*` spans path segments, so the glob reaches this route.
    // Proved with the path-to-regexp express itself resolves, not asserted.
    const pathToRegexp = require(require.resolve("path-to-regexp", { paths: [require.resolve("express")] })) as (
      p: string,
      keys: unknown[],
      opts: Record<string, unknown>
    ) => RegExp
    const re = pathToRegexp("/admin/partners/orgs*", [], {})
    expect(re.test("/admin/partners/orgs/example_501c3/verify")).toBe(true)
    expect(re.test("/admin/partners/other")).toBe(false)
  })
})

describe("POST /admin/partners/orgs/:key/verify — flag on", () => {
  beforeEach(() => {
    process.env[FLAG] = "true"
  })

  it("resolves both modules by their imported constants, in order, and nothing else", async () => {
    const dir = makeInMemoryDirectory([unverified501c3()])
    const { res, resolved } = await call(dir, { key: "example_501c3", body: {} })
    expect(res.statusCode).toBe(200)
    expect(resolved).toEqual([PARTNER_DIRECTORY_MODULE, IRS_EXEMPT_ORG_MODULE])
  })

  it("throws, not falls back, when either module is registered under a near-miss key", async () => {
    const dir = makeInMemoryDirectory([unverified501c3()])
    await expect(
      call(dir, { key: "example_501c3", body: {}, keys: { directory: "partnerDirectoryModuleService" } })
    ).rejects.toThrow(/Could not resolve 'partnerDirectory'/)
    await expect(call(dir, { key: "example_501c3", body: {}, keys: { irs: "irs-exempt-org" } })).rejects.toThrow(
      /Could not resolve 'irsExemptOrg'/
    )
    expect(dir.rows[0].verification_status).toBe("unverified")
  })

  it("writes the lookup's status, the file date and the irs_bulk_file source; the response carries all three plus published", async () => {
    const dir = makeInMemoryDirectory([unverified501c3()])
    const { res, irs } = await call(dir, { key: "example_501c3", body: {} })

    expect(irs.lookupEin).toHaveBeenCalledWith(EIN)
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({
      key: "example_501c3",
      applied: true,
      verification_status: "pub78_eligible",
      verification_source: IRS_BULK_FILE_SOURCE,
      verified_as_of: PUB78_AS_OF,
      published: false,
      auto_unpublished: false,
    })
    expect(res.body.verification_checked_at).toBeInstanceOf(Date)
    expect(res.body).not.toHaveProperty("reason")
    expect(dir.rows[0]).toMatchObject({
      verification_status: "pub78_eligible",
      verification_source: IRS_BULK_FILE_SOURCE,
      verified_as_of: PUB78_AS_OF,
    })
    // The route never writes the status itself: the one update is the service's.
    expect(dir.calls.update).toHaveLength(1)
  })

  it("the status is the lookup's, not the caller's: a different lookup, a different row", async () => {
    const dir = makeInMemoryDirectory([unverified501c3()])
    const { res } = await call(dir, { key: "example_501c3", body: {}, lookupEin: revokedFor })
    expect(res.body).toMatchObject({ verification_status: "revoked", verified_as_of: REVOCATION_AS_OF })
    expect(dir.rows[0].verification_status).toBe("revoked")
  })

  it("a revoked result on a published 501c3 unpublishes it, and the response says so", async () => {
    const dir = makeInMemoryDirectory([
      unverified501c3({ published: true, verification_status: "pub78_eligible", verified_as_of: PUB78_AS_OF }),
    ])
    const { res } = await call(dir, { key: "example_501c3", body: {}, lookupEin: revokedFor })
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ applied: true, verification_status: "revoked", published: false, auto_unpublished: true })
    expect(dir.rows[0].published).toBe(false)
    expect(dir.rows[0].metadata).toMatchObject({ auto_unpublished: { reason: "unverified_irs_org", verification_status: "revoked" } })
  })

  it("rejects every verification field in the body with a 400 that names it, looking nothing up", async () => {
    for (const field of PARTNER_ORG_VERIFICATION_FIELDS) {
      const dir = makeInMemoryDirectory([unverified501c3()])
      const value = field.endsWith("_at") || field.endsWith("_as_of") ? "2026-09-01T00:00:00Z" : "pub78_eligible"
      const { res, irs } = await call(dir, { key: "example_501c3", body: { [field]: value } })
      expect(res.statusCode).toBe(400)
      expect(res.body).toMatchObject({ type: "verification_fields_are_ingest_only", fields: [field] })
      expect(irs.lookupEin).not.toHaveBeenCalled()
      expect(dir.calls.update).toEqual([])
      expect(dir.rows[0].verification_status).toBe("unverified")
    }
  })

  it("rejects any other key in the body (only `ein` is accepted)", async () => {
    const dir = makeInMemoryDirectory([unverified501c3()])
    for (const body of [{ published: true }, { status: "revoked" }, { ein: EIN, name: "Renamed" }]) {
      const { res, irs } = await call(dir, { key: "example_501c3", body })
      expect(res.statusCode).toBe(400)
      expect(res.body.type).toBe("invalid_request")
      expect(irs.lookupEin).not.toHaveBeenCalled()
    }
    expect(dir.calls.update).toEqual([])
  })

  it("an `ein` override is normalised, stored on the org, and is the EIN looked up", async () => {
    const dir = makeInMemoryDirectory([unverified501c3({ ein: null })])
    const { res, irs } = await call(dir, {
      key: "example_501c3",
      body: { ein: "98-7654321" },
      lookupEin: async (ein) => pub78For(ein),
    })
    expect(res.statusCode).toBe(200)
    expect(irs.lookupEin).toHaveBeenCalledWith("987654321")
    expect(dir.rows[0].ein).toBe("987654321")
    expect(dir.rows[0].verification_status).toBe("pub78_eligible")
    // Two writes: the EIN (operator-writable), then the verification (ingest path).
    expect(dir.calls.update).toHaveLength(2)
    expect(dir.calls.update[0]).toMatchObject({ ein: "987654321" })
    expect(dir.calls.update[0]).not.toHaveProperty("verification_status")
  })

  it("a malformed `ein` override is a 400 and nothing is stored or looked up", async () => {
    const dir = makeInMemoryDirectory([unverified501c3()])
    const { res, irs } = await call(dir, { key: "example_501c3", body: { ein: "not-an-ein" } })
    expect(res.statusCode).toBe(400)
    expect(res.body.type).toBe("invalid_request")
    expect(irs.lookupEin).not.toHaveBeenCalled()
    expect(dir.rows[0].ein).toBe(EIN)
    expect(dir.calls.update).toEqual([])
  })

  it("an org with no EIN and no override is a 409 ein_required; the IRS module is never resolved", async () => {
    const dir = makeInMemoryDirectory([unverified501c3({ ein: null })])
    const { res, resolved, irs } = await call(dir, { key: "example_501c3", body: {} })
    expect(res.statusCode).toBe(409)
    expect(res.body.type).toBe("ein_required")
    expect(resolved).toEqual([PARTNER_DIRECTORY_MODULE])
    expect(irs.lookupEin).not.toHaveBeenCalled()
  })

  it("a coop is looked up but left unverified: 200 applied:false with the reason, row unchanged", async () => {
    const dir = makeInMemoryDirectory([unverified501c3({ org_type: "coop" })])
    const { res } = await call(dir, { key: "example_501c3", body: {}, lookupEin: async (ein) => ({
      state: "not_found",
      ein,
      as_of: REVOCATION_AS_OF,
      sources_as_of: { pub78: PUB78_AS_OF, revocation: REVOCATION_AS_OF, eo_bmf: null },
    }) })
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({
      applied: false,
      reason: "non_irs_org_type",
      verification_status: "unverified",
      verified_as_of: null,
      auto_unpublished: false,
    })
    expect(dir.calls.update).toEqual([])
  })

  it("404s an unknown key and 400s a missing one", async () => {
    const dir = makeInMemoryDirectory([unverified501c3()])
    expect((await call(dir, { key: "ghost", body: {} })).res.statusCode).toBe(404)
    expect((await call(dir, { body: {} })).res.statusCode).toBe(400)
  })
})
