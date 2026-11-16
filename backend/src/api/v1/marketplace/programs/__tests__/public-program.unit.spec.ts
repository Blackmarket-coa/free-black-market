/**
 * `GET /v1/marketplace/programs/:id` shows what the public list shows.
 *
 * The route is outside /store, /admin and /vendor and nothing authenticates
 * it. Seen on Postgres before this change, with no credentials: the detail
 * returned the whole row of an invite-only program, `brief_markdown`,
 * `budget_cap_cents`, `budget_spent_cents`, `hold_days`,
 * `referral_level_splits` and `metadata` included, while the list projected 18
 * fields of the open-application types only.
 */
import { CREATOR_PROGRAM_MODULE } from "../../../../../modules/creator-program"
import { GET as getProgram } from "../[id]/route"
import { GET as listPrograms } from "../route"
import { isPubliclyReadableProgram, toPublicProgram } from "../public-program"

type Res = { statusCode: number; body: unknown; status: (c: number) => Res; json: (p: unknown) => Res }
const createRes = (): Res => {
  const res = { statusCode: 200, body: undefined } as Res
  res.status = (code: number) => {
    res.statusCode = code
    return res
  }
  res.json = (payload: unknown) => {
    res.body = payload
    return res
  }
  return res
}

const row = (over: Record<string, unknown>) => ({
  id: "prog_1",
  vendor_id: "sel_1",
  title: "Spring push",
  slug: "spring-push",
  description: "Sell our seeds",
  brief_markdown: "PRIVATE BRIEF",
  program_type: "affiliate_open",
  status: "active",
  commission_percent: 12,
  commission_flat_cents: null,
  sponsorship_flat_cents: null,
  pool_total_cents: null,
  pool_period: null,
  cookie_window_days: 7,
  hold_days: 21,
  attribution_model: "last_click",
  currency_code: "usd",
  product_ids: ["prod_1"],
  collection_ids: null,
  category_ids: null,
  required_platforms: null,
  min_followers: 100,
  geo_allowlist: ["US"],
  starts_at: null,
  ends_at: null,
  budget_cap_cents: 900000,
  budget_spent_cents: 123456,
  requires_kyc: false,
  min_verification_level: "level_2",
  max_referral_levels: 2,
  referral_level_splits: { L1: 80, L2: 20 },
  metadata: { internal_note: "do not share" },
  ...over,
})

const PRIVATE_KEYS = [
  "brief_markdown",
  "budget_cap_cents",
  "budget_spent_cents",
  "hold_days",
  "attribution_model",
  "referral_level_splits",
  "max_referral_levels",
  "min_verification_level",
  "geo_allowlist",
  "collection_ids",
  "category_ids",
  "required_platforms",
  "metadata",
]

const setup = (rows: Record<string, unknown>[], params: Record<string, string> = {}) => {
  const service = {
    listCreatorPrograms: jest.fn(async (filters: { id?: string }) => rows.filter((r) => !filters.id || r.id === filters.id)),
    listOpenPrograms: jest.fn(async () => rows.filter((r) => r.status === "active")),
  }
  const req = {
    params,
    query: {},
    scope: {
      resolve: (key: string) => {
        if (key === CREATOR_PROGRAM_MODULE) return service
        throw new Error(`unexpected container key in spec: ${key}`)
      },
    },
  }
  return { req, service }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = async (handler: (req: any, res: any) => Promise<unknown>, req: unknown) => {
  const res = createRes()
  await handler(req, res)
  return res
}

const NOT_FOUND = { message: "Program not found", type: "not_found" }

describe("GET /v1/marketplace/programs/:id", () => {
  it("serves an open program as the list's projection plus its status, and no private column", async () => {
    const { req } = setup([row({})], { id: "prog_1" })
    const res = await run(getProgram, req)

    expect(res.statusCode).toBe(200)
    const { program } = res.body as { program: Record<string, unknown> }
    expect(program).toEqual({ ...toPublicProgram(row({})), status: "active" })
    for (const key of PRIVATE_KEYS) expect(program).not.toHaveProperty(key)
    const text = JSON.stringify(res.body)
    for (const value of ["PRIVATE BRIEF", "900000", "123456", "do not share", "level_2"]) expect(text).not.toContain(value)
  })

  it.each(["affiliate_open", "engagement_pool", "commission_boost"])("serves a %s program that is paused or closed, still projected", async (program_type) => {
    for (const status of ["paused", "closed", "archived"]) {
      const { req } = setup([row({ program_type, status })], { id: "prog_1" })
      const res = await run(getProgram, req)
      expect([status, res.statusCode]).toEqual([status, 200])
      for (const key of PRIVATE_KEYS) expect((res.body as { program: object }).program).not.toHaveProperty(key)
    }
  })

  it.each([
    ["an invite-only program", row({ program_type: "affiliate_invite" })],
    ["a sponsored brief", row({ program_type: "sponsored_brief" })],
    ["a draft", row({ status: "draft" })],
    ["a draft of an invite-only program", row({ program_type: "affiliate_invite", status: "draft" })],
  ])("answers %s exactly as an id that does not exist", async (_label, program) => {
    const real = await run(getProgram, setup([program], { id: "prog_1" }).req)
    const missing = await run(getProgram, setup([program], { id: "prog_missing" }).req)

    expect([real.statusCode, real.body]).toEqual([404, NOT_FOUND])
    expect([missing.statusCode, missing.body]).toEqual([404, NOT_FOUND])
  })
})

describe("GET /v1/marketplace/programs", () => {
  it("lists open-application programs only, each through the same projection", async () => {
    const rows = [
      row({ id: "prog_open" }),
      row({ id: "prog_invite", program_type: "affiliate_invite" }),
      row({ id: "prog_brief", program_type: "sponsored_brief" }),
      row({ id: "prog_pool", program_type: "engagement_pool" }),
    ]
    const res = await run(listPrograms, setup(rows).req)

    const body = res.body as { programs: Record<string, unknown>[]; total: number }
    expect(body.programs.map((p) => p.id)).toEqual(["prog_open", "prog_pool"])
    expect(body.total).toBe(2)
    expect(body.programs[0]).toEqual(toPublicProgram(row({ id: "prog_open" })))
    for (const program of body.programs) for (const key of PRIVATE_KEYS) expect(program).not.toHaveProperty(key)
  })
})

describe("isPubliclyReadableProgram", () => {
  it("is false for nothing at all", () => {
    expect(isPubliclyReadableProgram(null)).toBe(false)
    expect(isPubliclyReadableProgram(undefined)).toBe(false)
  })
})
