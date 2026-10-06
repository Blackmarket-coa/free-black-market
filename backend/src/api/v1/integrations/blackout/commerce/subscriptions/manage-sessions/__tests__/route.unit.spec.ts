/**
 * POST …/commerce/subscriptions/manage-sessions — the mint.
 *
 * Real code: the route, requireCommerceApiKey, the read-only customer lookup
 * (blackout-identity.ts, against a pg fake that answers only its SELECT), the
 * token / nonce / return-origin helpers. Faked: the generated session CRUD.
 * The container resolves only MARKETPLACE_LISTING_MODULE and
 * ContainerRegistrationKeys.PG_CONNECTION — never Modules.CUSTOMER, so a path
 * that tried to create a customer would throw here.
 */
import {
  MANAGE_SESSION_TTL_SECONDS,
  csrfNonceFor,
  sha256Hex,
} from "../../../../../../../../lib/blackout-manage-session"
import { PHASE0_FEATURE_FLAGS } from "../../../../../../../../shared/feature-flags"
import { API_KEY, FBM_BASE, makeListingService, makePg, mint } from "./manage-fakes"

const FLAG = PHASE0_FEATURE_FLAGS.CONSUMER_SUBSCRIPTIONS_V1

beforeEach(() => {
  process.env.FBM_BLACKOUT_INTEGRATION = "1"
  process.env.FREEBLACKMARKET_API_KEY = API_KEY
  process.env.FREEBLACKMARKET_BASE_URL = FBM_BASE
  process.env[FLAG] = "true"
})
afterEach(() => {
  delete process.env.FBM_BLACKOUT_INTEGRATION
  delete process.env.FREEBLACKMARKET_API_KEY
  delete process.env.FREEBLACKMARKET_BASE_URL
  delete process.env.BLACKOUT_RETURN_ORIGINS
  delete process.env[FLAG]
})

const member = { id: "cus_a", metadata: { blackout_user_id: "blk_a" } }

describe("manage-session mint", () => {
  it("binds the one customer carrying the Blackout id and returns { url, expires_at }", async () => {
    const service = makeListingService()
    const pg = makePg([member, { id: "cus_b", metadata: { blackout_user_id: "blk_b" } }])
    const before = Date.now()
    const { res, token } = await mint({ service, pg, body: { blackout_user_id: "blk_a" } })

    expect(res.statusCode).toBe(201)
    const body = res.body as { url: string; expires_at: string }
    expect(Object.keys(body).sort()).toEqual(["expires_at", "url"])
    expect(body.url).toMatch(
      /^https:\/\/fbm\.test\/v1\/integrations\/blackout\/commerce\/subscriptions\/manage-sessions\/[A-Za-z0-9_-]{43}\/page$/
    )
    const ttl = new Date(body.expires_at).getTime() - before
    expect(ttl).toBeGreaterThanOrEqual(MANAGE_SESSION_TTL_SECONDS * 1000 - 50)
    expect(ttl).toBeLessThanOrEqual(MANAGE_SESSION_TTL_SECONDS * 1000 + 1000)

    expect(service.sessions).toHaveLength(1)
    const row = service.sessions[0]
    expect(row.customer_id).toBe("cus_a")
    expect(row.blackout_user_id).toBe("blk_a")
    // Only hashes are stored: never the token itself.
    expect(row.token_hash).toBe(sha256Hex(token as string))
    expect(row.csrf_nonce_hash).toBe(sha256Hex(csrfNonceFor(token as string)))
    expect(JSON.stringify(row)).not.toContain(token as string)
  })

  it("0 matching customers: still 201, bound to no customer, nothing created", async () => {
    const service = makeListingService()
    const pg = makePg([])
    const { res } = await mint({ service, pg, body: { blackout_user_id: "blk_new" } })
    expect(res.statusCode).toBe(201)
    expect(service.sessions[0].customer_id).toBeNull()
    // Read-only: the only SQL run is the SELECT.
    expect(pg.statements).toHaveLength(1)
    expect(pg.statements[0].sql).toMatch(/^\s*SELECT id FROM customer/)
  })

  it("more than one customer with the id: 409 identity_ambiguous, no session written", async () => {
    const service = makeListingService()
    const pg = makePg([member, { id: "cus_dup", metadata: { blackout_user_id: "blk_a" } }])
    const { res } = await mint({ service, pg, body: { blackout_user_id: "blk_a" } })
    expect(res.statusCode).toBe(409)
    expect(res.body).toMatchObject({ code: "identity_ambiguous" })
    expect(service.createBlackoutManageSessions).not.toHaveBeenCalled()
  })

  it("never resolves by mxid: the body cannot carry one, and no SQL mentions it", async () => {
    const service = makeListingService()
    const pg = makePg([{ id: "cus_mx", metadata: { mxid: "@a:blackout" } }])
    for (const extra of [{ mxid: "@a:blackout" }, { customerId: "cus_mx" }, { userId: "blk_a" }]) {
      const { res } = await mint({ service, pg, body: { blackout_user_id: "blk_a", ...extra } })
      expect(res.statusCode).toBe(400)
    }
    const { res } = await mint({ service, pg, body: { blackout_user_id: "blk_a" } })
    expect(res.statusCode).toBe(201)
    expect(service.sessions[0].customer_id).toBeNull()
    expect(pg.statements.every((s) => !/mxid/.test(s.sql))).toBe(true)
  })

  it("a failed lookup is a 500, never 'no customer'", async () => {
    const service = makeListingService()
    const pg = makePg([])
    pg.raw.mockRejectedValueOnce(new Error("connection reset"))
    const { res } = await mint({ service, pg, body: { blackout_user_id: "blk_a" } })
    expect(res.statusCode).toBe(500)
    expect(service.createBlackoutManageSessions).not.toHaveBeenCalled()
  })

  it("a new mint revokes the member's earlier sessions, not anyone else's", async () => {
    const service = makeListingService()
    const pg = makePg([member, { id: "cus_b", metadata: { blackout_user_id: "blk_b" } }])
    await mint({ service, pg, body: { blackout_user_id: "blk_a" } })
    await mint({ service, pg, body: { blackout_user_id: "blk_b" } })
    await mint({ service, pg, body: { blackout_user_id: "blk_a" } })
    const a = service.sessions.filter((s) => s.blackout_user_id === "blk_a")
    expect(a).toHaveLength(2)
    expect(a[0].revoked_at).toBeInstanceOf(Date)
    expect(a[1].revoked_at).toBeNull()
    expect(service.sessions.find((s) => s.blackout_user_id === "blk_b")?.revoked_at).toBeNull()
  })

  it("return_url is kept only when its origin is allowlisted, otherwise ignored", async () => {
    process.env.BLACKOUT_RETURN_ORIGINS = "https://app.theblackout.app, https://other.example"
    const service = makeListingService()
    const pg = makePg([member])
    const cases: Array<[string, string | null]> = [
      ["https://app.theblackout.app/settings/subscriptions", "https://app.theblackout.app/settings/subscriptions"],
      ["https://evil.example/app.theblackout.app", null],
      ["javascript:alert(1)", null],
      ["not a url", null],
    ]
    for (const [returnUrl, stored] of cases) {
      const { res } = await mint({ service, pg, body: { blackout_user_id: "blk_a", return_url: returnUrl } })
      expect(res.statusCode).toBe(201)
      expect(service.sessions[service.sessions.length - 1].return_url).toBe(stored)
    }
    delete process.env.BLACKOUT_RETURN_ORIGINS
    await mint({
      service,
      pg,
      body: { blackout_user_id: "blk_a", return_url: "https://app.theblackout.app/x" },
    })
    expect(service.sessions[service.sessions.length - 1].return_url).toBeNull()
  })

  it("requires the commerce API key", async () => {
    const service = makeListingService()
    const { res } = await mint({ service, pg: makePg([member]), body: { blackout_user_id: "blk_a" }, authorized: false })
    expect(res.statusCode).toBe(401)
    expect(service.createBlackoutManageSessions).not.toHaveBeenCalled()
  })

  it.each([
    ["FBM_BLACKOUT_INTEGRATION off", () => delete process.env.FBM_BLACKOUT_INTEGRATION],
    ["FF_CONSUMER_SUBSCRIPTIONS_V1 off", () => delete process.env[FLAG]],
    ["FF_CONSUMER_SUBSCRIPTIONS_V1 not the literal 'true'", () => (process.env[FLAG] = "1")],
  ])("%s: 404 feature_disabled, nothing looked up or written", async (_label, flip) => {
    flip()
    const service = makeListingService()
    const pg = makePg([member])
    const { res } = await mint({ service, pg, body: { blackout_user_id: "blk_a" } })
    expect(res.statusCode).toBe(404)
    expect(res.body).toMatchObject({ code: "feature_disabled" })
    expect(pg.raw).not.toHaveBeenCalled()
    expect(service.createBlackoutManageSessions).not.toHaveBeenCalled()
  })
})
