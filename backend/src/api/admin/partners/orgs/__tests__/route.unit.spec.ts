import * as fs from "fs"
import * as path from "path"
import { GET as LIST, POST } from "../route"
import { GET as GET_ONE, PATCH } from "../[key]/route"
import {
  PARTNER_DIRECTORY_MODULE,
  PARTNER_ORG_VERIFICATION_FIELDS,
  publishRefusal,
  PUBLISH_MOU_NOTICE,
} from "../../../../../modules/partner-directory"
import { PHASE0_FEATURE_FLAGS } from "../../../../../shared/feature-flags"
import {
  makeInMemoryDirectory,
  type InMemoryDirectory,
  type OrgRow,
} from "../../../../../modules/partner-directory/__tests__/in-memory-partner-orgs"

/**
 * `/admin/partners/orgs` is the operator's write path for pilot-partner
 * records. What these prove, against the REAL service (built off its
 * prototype with only the generated CRUD shadowed — see the helper):
 *
 * - dark with the flag off, and the module is never even resolved;
 * - the four verification columns are a 400 from the body, named;
 * - publishing an unverified 501c3 is a 409 from the service's guard, and
 *   the row stays unpublished;
 * - the resolve key is the imported constant — a scope that registers the
 *   service under any other key makes the route throw instead of pass.
 */

const FLAG = PHASE0_FEATURE_FLAGS.NONPROFIT_PARITY_V1

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

type Handler = typeof LIST | typeof POST | typeof GET_ONE | typeof PATCH
type Req = Parameters<Handler>[0]
type Res = Parameters<Handler>[1]

function makeScope(dir: InMemoryDirectory, registeredAs: string = PARTNER_DIRECTORY_MODULE) {
  const resolved: string[] = []
  return {
    resolved,
    scope: {
      resolve: (key: string) => {
        resolved.push(key)
        if (key === registeredAs) return dir.service
        // awilix throws on an unknown key; a fallback here would let a wrong
        // constant pass silently (CLAUDE.md rule 2).
        throw new Error(`Could not resolve '${key}'`)
      },
    },
  }
}

async function call(
  handler: Handler,
  dir: InMemoryDirectory,
  opts: { body?: unknown; key?: string; registeredAs?: string } = {}
) {
  const { scope, resolved } = makeScope(dir, opts.registeredAs)
  const res = createRes()
  const req = { body: opts.body, params: opts.key ? { key: opts.key } : {}, scope } as unknown as Req
  await handler(req, res as unknown as Res)
  return { res, resolved }
}

const unverified501c3 = (): Partial<OrgRow> & { key: string; name: string } => ({
  key: "example_501c3",
  name: "Example 501(c)(3)",
  org_type: "irs_501c3",
  ein: "123456789",
})

afterEach(() => {
  delete process.env[FLAG]
})

describe("/admin/partners/orgs — flag off", () => {
  it("every handler answers 404 feature_disabled and never resolves the module", async () => {
    const dir = makeInMemoryDirectory([unverified501c3()])
    for (const [handler, opts] of [
      [LIST, {}],
      [POST, { body: { key: "x_org", name: "X" } }],
      [GET_ONE, { key: "example_501c3" }],
      [PATCH, { key: "example_501c3", body: { name: "Y" } }],
    ] as Array<[Handler, { body?: unknown; key?: string }]>) {
      const { res, resolved } = await call(handler, dir, opts)
      expect(res.statusCode).toBe(404)
      expect(res.body).toMatchObject({ type: "feature_disabled" })
      expect(resolved).toEqual([])
    }
    expect(dir.calls.create).toEqual([])
    expect(dir.calls.update).toEqual([])
  })

  it("is registered in middlewares.ts behind user auth and the flag gate", () => {
    const source = fs.readFileSync(path.resolve(__dirname, "../../../../middlewares.ts"), "utf8")
    const block = source
      .split(/\n\s*\{\s*\n/)
      .find((b) => b.includes('matcher: "/admin/partners/orgs*"'))
    expect(block).toBeDefined()
    expect(block).toContain('authenticate("user"')
    expect(block).toContain('requireFeatureFlagMiddleware("NONPROFIT_PARITY_V1")')
  })
})

describe("/admin/partners/orgs — flag on", () => {
  beforeEach(() => {
    process.env[FLAG] = "true"
  })

  it("resolves the directory by the imported constant and nothing else", async () => {
    const dir = makeInMemoryDirectory([unverified501c3()])
    const { res, resolved } = await call(LIST, dir)
    expect(res.statusCode).toBe(200)
    expect(resolved).toEqual([PARTNER_DIRECTORY_MODULE])
    expect((res.body.orgs as OrgRow[]).map((o) => o.key)).toEqual(["example_501c3"])

    // Registered under a near-miss key, the route must fail loudly, not fall back.
    await expect(call(LIST, dir, { registeredAs: "partnerDirectoryModuleService" })).rejects.toThrow(
      /Could not resolve/
    )
  })

  it("creates with the model defaults: unpublished, unverified, standalone, empty states/serves", async () => {
    const dir = makeInMemoryDirectory()
    const { res } = await call(POST, dir, {
      body: { key: "new_org", name: "New Org", org_type: "irs_501c3", ein: "12-3456789" },
    })
    expect(res.statusCode).toBe(201)
    const org = res.body.org as OrgRow
    expect(org).toMatchObject({
      key: "new_org",
      name: "New Org",
      org_type: "irs_501c3",
      ein: "123456789",
      verification_status: "unverified",
      relationship: "standalone",
      published: false,
      fiscal_host_key: null,
      stripe_connect_account_id: null,
      states: [],
      serves: [],
    })
    expect(res.body.notice).toBeUndefined()
    expect(dir.calls.create).toHaveLength(1)
    // The write that reached persistence carried no verification column.
    for (const field of PARTNER_ORG_VERIFICATION_FIELDS) {
      expect(dir.calls.create[0]).not.toHaveProperty(field)
    }
  })

  it("rejects every verification field in a POST body with a 400 that names it, writing nothing", async () => {
    for (const field of PARTNER_ORG_VERIFICATION_FIELDS) {
      const dir = makeInMemoryDirectory()
      const value = field.endsWith("_at") || field.endsWith("_as_of") ? "2026-09-01T00:00:00Z" : "pub78_eligible"
      const { res } = await call(POST, dir, { body: { key: "new_org", name: "New Org", [field]: value } })
      expect(res.statusCode).toBe(400)
      expect(res.body).toMatchObject({ type: "verification_fields_are_ingest_only", fields: [field] })
      expect(dir.calls.create).toEqual([])
    }
  })

  it("rejects verification fields in a PATCH body too, leaving the row untouched", async () => {
    const dir = makeInMemoryDirectory([unverified501c3()])
    const { res } = await call(PATCH, dir, {
      key: "example_501c3",
      body: { verification_status: "pub78_eligible", verified_as_of: "2026-09-01T00:00:00Z" },
    })
    expect(res.statusCode).toBe(400)
    expect(res.body).toMatchObject({
      type: "verification_fields_are_ingest_only",
      fields: ["verification_status", "verified_as_of"],
    })
    expect(dir.rows[0].verification_status).toBe("unverified")
    expect(dir.calls.update).toEqual([])
  })

  it("rejects unknown keys and bad shapes with a plain 400", async () => {
    const dir = makeInMemoryDirectory()
    const bad = [
      { key: "new_org", name: "New Org", contact_email: "x@y.z" },
      { key: "Bad Key", name: "New Org" },
      { key: "new_org", name: "New Org", ein: "12345" },
      { key: "new_org", name: "New Org", url: "http://insecure.example" },
      { key: "new_org", name: "New Org", stripe_connect_account_id: "cus_123" },
      { key: "new_org", name: "New Org", org_type: "llc" },
      { key: "new_org", name: "New Org", serves: ["landlord"] },
    ]
    for (const body of bad) {
      const { res } = await call(POST, dir, { body })
      expect(res.statusCode).toBe(400)
      expect(res.body.type).toBe("invalid_request")
    }
    expect(dir.calls.create).toEqual([])
  })

  it("refuses to publish an unverified 501c3 on create (409, nothing written)", async () => {
    const dir = makeInMemoryDirectory()
    const { res } = await call(POST, dir, {
      body: { key: "new_org", name: "New Org", org_type: "irs_501c3", published: true },
    })
    expect(res.statusCode).toBe(409)
    expect(res.body).toMatchObject({ type: "publish_refused", code: "unverified_irs_org" })
    // The message is the service guard's, not a route-local string.
    expect(res.body.message).toBe(
      publishRefusal({ org_type: "irs_501c3", verification_status: "unverified" })?.message
    )
    expect(dir.calls.create).toEqual([])
  })

  it("refuses to publish an unverified 501c3 / 501c4 on PATCH and leaves the row unpublished", async () => {
    for (const org_type of ["irs_501c3", "irs_501c4"] as const) {
      const dir = makeInMemoryDirectory([{ ...unverified501c3(), org_type }])
      const { res } = await call(PATCH, dir, { key: "example_501c3", body: { published: true } })
      expect(res.statusCode).toBe(409)
      expect(res.body).toMatchObject({ type: "publish_refused", code: "unverified_irs_org" })
      expect(dir.rows[0].published).toBe(false)
      expect(dir.calls.update).toEqual([])
    }
  })

  it("publishes once the ingest has written an affirmed status, and surfaces the L18 MOU notice", async () => {
    for (const verification_status of ["pub78_eligible", "bmf_only"]) {
      const dir = makeInMemoryDirectory([
        { ...unverified501c3(), verification_status, verified_as_of: new Date("2026-09-01T00:00:00Z") },
      ])
      const { res } = await call(PATCH, dir, { key: "example_501c3", body: { published: true } })
      expect(res.statusCode).toBe(200)
      expect((res.body.org as OrgRow).published).toBe(true)
      expect(res.body.notice).toBe(PUBLISH_MOU_NOTICE)
      expect(res.body.notice).toMatch(/MOU/)
      expect(res.body.notice).toMatch(/L18/)
    }
  })

  it("refuses to publish with no org_type at all", async () => {
    const dir = makeInMemoryDirectory([{ key: "nameless", name: "Nameless", org_type: null }])
    const { res } = await call(PATCH, dir, { key: "nameless", body: { published: true } })
    expect(res.statusCode).toBe(409)
    expect(res.body).toMatchObject({ type: "publish_refused", code: "org_type_required" })
    expect(dir.rows[0].published).toBe(false)
  })

  it("a coop needs publish_unverified_ack on the request; the ack is not stored", async () => {
    const dir = makeInMemoryDirectory([{ key: "a_coop", name: "A Coop", org_type: "coop" }])

    const refused = await call(PATCH, dir, { key: "a_coop", body: { published: true } })
    expect(refused.res.statusCode).toBe(409)
    expect(refused.res.body).toMatchObject({ type: "publish_refused", code: "unverified_ack_required" })
    expect(dir.rows[0].published).toBe(false)

    const ok = await call(PATCH, dir, { key: "a_coop", body: { published: true, publish_unverified_ack: true } })
    expect(ok.res.statusCode).toBe(200)
    expect(dir.rows[0].published).toBe(true)
    expect(dir.calls.update[0]).not.toHaveProperty("publish_unverified_ack")
    expect(dir.rows[0]).not.toHaveProperty("publish_unverified_ack")
  })

  it("changing org_type on a published row re-runs the guard", async () => {
    // Published as a coop with ack; retyping it as a 501c3 would publish an
    // unverified IRS org, so the retype is refused.
    const dir = makeInMemoryDirectory([{ key: "a_coop", name: "A Coop", org_type: "coop", published: true }])
    const { res } = await call(PATCH, dir, { key: "a_coop", body: { org_type: "irs_501c3" } })
    expect(res.statusCode).toBe(409)
    expect(res.body).toMatchObject({ code: "unverified_irs_org" })
    expect(dir.rows[0].org_type).toBe("coop")
  })

  it("PATCH changes only the fields sent and never the key", async () => {
    const dir = makeInMemoryDirectory([unverified501c3()])
    const { res } = await call(PATCH, dir, {
      key: "example_501c3",
      body: { tagline: "Mutual aid", stripe_connect_account_id: "acct_1ABC", states: ["Lowcountry"] },
    })
    expect(res.statusCode).toBe(200)
    expect(dir.rows[0]).toMatchObject({
      key: "example_501c3",
      name: "Example 501(c)(3)",
      tagline: "Mutual aid",
      stripe_connect_account_id: "acct_1ABC",
      states: ["Lowcountry"],
      published: false,
    })
    expect(dir.calls.update).toHaveLength(1)
    expect(dir.calls.update[0]).not.toHaveProperty("key")
  })

  it("404s a missing key on GET and PATCH, 409s a duplicate key on POST", async () => {
    const dir = makeInMemoryDirectory([unverified501c3()])
    expect((await call(GET_ONE, dir, { key: "nope" })).res.statusCode).toBe(404)
    expect((await call(PATCH, dir, { key: "nope", body: { name: "x" } })).res.statusCode).toBe(404)
    const dup = await call(POST, dir, { body: { key: "example_501c3", name: "Again" } })
    expect(dup.res.statusCode).toBe(409)
    expect(dup.res.body.type).toBe("duplicate")
    expect(dir.rows).toHaveLength(1)
  })

  it("fiscal_host_key must name another existing org", async () => {
    const dir = makeInMemoryDirectory([{ key: "host_org", name: "Host", org_type: "irs_501c3" }])
    const self = await call(POST, dir, {
      body: { key: "collective", name: "Collective", relationship: "sponsored_collective", fiscal_host_key: "collective" },
    })
    expect(self.res.statusCode).toBe(400)
    const missing = await call(POST, dir, {
      body: { key: "collective", name: "Collective", relationship: "sponsored_collective", fiscal_host_key: "ghost" },
    })
    expect(missing.res.statusCode).toBe(400)
    const ok = await call(POST, dir, {
      body: { key: "collective", name: "Collective", relationship: "sponsored_collective", fiscal_host_key: "host_org" },
    })
    expect(ok.res.statusCode).toBe(201)
    expect((ok.res.body.org as OrgRow).fiscal_host_key).toBe("host_org")
  })
})
