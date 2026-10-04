import { POST as assignCarrier } from "../[id]/carrier/route"
import { POST as recordContribution } from "../[id]/carrier-contributions/route"
import { POST as recordDistribution } from "../[id]/carrier-distributions/route"
import { GET as storeInvestments, POST as storeInvest } from "../../../../store/hawala/investments/route"
import { GET as storePools } from "../../../../store/hawala/pools/route"
import { POST as vendorWithdraw } from "../../../../vendor/hawala/pools/[id]/withdraw/route"
import { HAWALA_LEDGER_MODULE } from "../../../../../modules/hawala-ledger"
import { PARTNER_DIRECTORY_MODULE } from "../../../../../modules/partner-directory"
import {
  makeInMemoryDirectory,
  type InMemoryDirectory,
  type OrgRow,
} from "../../../../../modules/partner-directory/__tests__/in-memory-partner-orgs"
import {
  makeAccount,
  makePool,
  makePoolAccount,
  makePoolLedger,
  type PoolLedger,
  type Row,
} from "../../../../../modules/hawala-ledger/__tests__/in-memory-pool-ledger"
import { PHASE0_FEATURE_FLAGS } from "../../../../../shared/feature-flags"
import { requireFeatureFlagMiddleware } from "../../../../../shared/runtime-module-gates"

/**
 * The carrier routes against the REAL pieces: the real partner-directory
 * service (prototype + shadowed CRUD), the real hawala-ledger service
 * (prototype + shadowed CRUD, so `assignPoolCarrier`'s snapshot validation,
 * the createTransfer guard and the derived totals are the code that ships),
 * and the real `requireFeatureFlagMiddleware` for BOTH flags. Every module is
 * keyed on its imported constant and the scope throws on anything else
 * (CLAUDE.md rule 2): a near-miss key fails rather than passing on a fallback.
 *
 * Pinned (docs/BMC_SURVIVAL_PROGRAMS.md Decision 6b; L26, L11):
 *   - the three admin routes are dark (404 feature_disabled through the real
 *     middleware) when EITHER flag is off, and the handler is never reached;
 *   - any carrier refusal — unknown key, unpublished, no account, unverified
 *     (incl. not_found / revoked) — is `forbidden()`: 403, ONE body, so the
 *     response cannot say which org keys exist; no snapshot is built, no
 *     hawala write happens;
 *   - a verified org is frozen into the pool (never its account id), and the
 *     hawala service refuses a pool with ledger funds (409);
 *   - contributions and distributions are records: 201 on the first, 200
 *     already_recorded on a replay, derived totals, no ledger entry;
 *   - POST /store/hawala/investments answers 409 carried_pool before any
 *     wallet read, and 409 no_carrier (from the service) with the flag on;
 *   - POST /vendor/hawala/pools/:id/withdraw answers 409 carried_pool before
 *     any balance read, account creation or transfer;
 *   - GET /store/hawala/pools carries `carrier` and a null balance for a
 *     carried pool.
 */

const PARITY = PHASE0_FEATURE_FLAGS.NONPROFIT_PARITY_V1
const POOLS = PHASE0_FEATURE_FLAGS.INVESTMENT_POOLS_V1
const AS_OF = new Date("2026-09-10T09:18:37Z")

type TestRes = {
  statusCode: number
  body: Record<string, unknown>
  status: (code: number) => TestRes
  json: (payload: unknown) => TestRes
}
const createRes = (): TestRes => {
  const res = { statusCode: 200, body: {} } as TestRes
  res.status = (c) => ((res.statusCode = c), res)
  res.json = (p) => ((res.body = p as Record<string, unknown>), res)
  return res
}

type Handler = (req: never, res: never) => Promise<unknown>

const gulp = (over: Partial<OrgRow> = {}): Partial<OrgRow> & { key: string; name: string } => ({
  key: "ground_up_liberation_project",
  name: "Ground Up Liberation Project",
  org_type: "irs_501c3",
  ein: "123456789",
  verification_status: "pub78_eligible",
  verified_as_of: AS_OF,
  stripe_connect_account_id: "acct_1GULP",
  published: true,
  ...over,
})

function carried(id: string, over: Partial<Row> = {}): Row {
  return makePool(id, {
    carrier_org_key: "ground_up_liberation_project",
    carrier_snapshot: {
      org_key: "ground_up_liberation_project",
      org_type: "irs_501c3",
      verification_status: "pub78_eligible",
      verified_as_of: AS_OF.toISOString(),
      stripe_connect_account_present: true,
      snapshot_at: "2026-10-04T12:00:00.000Z",
    },
    ...over,
  })
}

type Ctx = {
  scope: { resolve: <T>(key: string) => T }
  resolved: string[]
  dir: InMemoryDirectory
  ledger: PoolLedger
}

function makeCtx(opts: { orgs?: Array<Partial<OrgRow> & { key: string; name: string }>; ledger?: PoolLedger; keys?: { directory?: string; hawala?: string } } = {}): Ctx {
  const dir = makeInMemoryDirectory(opts.orgs ?? [gulp()])
  const ledger =
    opts.ledger ??
    makePoolLedger({
      pools: [makePool("pool_1")],
      accounts: [makeAccount("acc-wallet"), makePoolAccount("acc-pool_1")],
    })
  const directoryKey = opts.keys?.directory ?? PARTNER_DIRECTORY_MODULE
  const hawalaKey = opts.keys?.hawala ?? HAWALA_LEDGER_MODULE
  const resolved: string[] = []
  const scope = {
    resolve: <T,>(key: string): T => {
      resolved.push(key)
      if (key === directoryKey) return dir.service as unknown as T
      if (key === hawalaKey) return ledger.service as unknown as T
      throw new Error(`Could not resolve '${key}'`)
    },
  }
  return { scope, resolved, dir, ledger }
}

type ReqShape = { params?: Record<string, string>; body?: unknown; headers?: Record<string, string>; auth_context?: { actor_id: string }; _seller_id?: string }

async function call(handler: Handler, ctx: Ctx, req: ReqShape) {
  const res = createRes()
  await handler({ ...req, scope: ctx.scope } as never, res as never)
  return res
}

/** The route as registered: both real flag middlewares, then the handler. */
async function throughGates(handler: Handler, ctx: Ctx, req: ReqShape) {
  const res = createRes()
  const request = { ...req, scope: ctx.scope } as never
  let reached = false
  await requireFeatureFlagMiddleware("INVESTMENT_POOLS_V1")(request, res as never, async () => {
    await requireFeatureFlagMiddleware("NONPROFIT_PARITY_V1")(request, res as never, async () => {
      reached = true
      await handler(request, res as never)
    })
  })
  return { res, reached }
}

const FORBIDDEN_BODY = { message: "You do not have access to this record.", type: "not_allowed" }

afterEach(() => {
  delete process.env[PARITY]
  delete process.env[POOLS]
})

describe("gating — neither flag alone opens the carrier routes", () => {
  const routes: Array<[string, Handler, unknown]> = [
    ["carrier", assignCarrier as unknown as Handler, { carrier_org_key: "ground_up_liberation_project" }],
    ["carrier-contributions", recordContribution as unknown as Handler, { amount: 10, carrier_reference: "r" }],
    ["carrier-distributions", recordDistribution as unknown as Handler, { amount: 10, carrier_reference: "d" }],
  ]

  it("both unset: 404 feature_disabled naming FF_INVESTMENT_POOLS_V1, handler never reached, nothing resolved", async () => {
    for (const [, handler, body] of routes) {
      const ctx = makeCtx()
      const { res, reached } = await throughGates(handler, ctx, { params: { id: "pool_1" }, body })
      expect(res.statusCode).toBe(404)
      expect(res.body).toMatchObject({ type: "feature_disabled", message: expect.stringContaining(POOLS) })
      expect(reached).toBe(false)
      expect(ctx.resolved).toEqual([])
    }
  })

  it("INVESTMENT_POOLS_V1 alone: 404 feature_disabled naming FF_NONPROFIT_PARITY_V1, handler never reached", async () => {
    process.env[POOLS] = "true"
    for (const [, handler, body] of routes) {
      const ctx = makeCtx()
      const { res, reached } = await throughGates(handler, ctx, { params: { id: "pool_1" }, body })
      expect(res.statusCode).toBe(404)
      expect(res.body).toMatchObject({ type: "feature_disabled", message: expect.stringContaining(PARITY) })
      expect(reached).toBe(false)
      expect(ctx.resolved).toEqual([])
    }
  })

  it("NONPROFIT_PARITY_V1 alone: still 404 through the pools matcher", async () => {
    process.env[PARITY] = "true"
    for (const [, handler, body] of routes) {
      const ctx = makeCtx()
      const { res, reached } = await throughGates(handler, ctx, { params: { id: "pool_1" }, body })
      expect(res.statusCode).toBe(404)
      expect(reached).toBe(false)
    }
  })

  it("the handlers repeat the parity check themselves (a matcher typo cannot open them)", async () => {
    process.env[POOLS] = "true"
    for (const [, handler, body] of routes) {
      const ctx = makeCtx()
      const res = await call(handler, ctx, { params: { id: "pool_1" }, body })
      expect(res.statusCode).toBe(404)
      expect(res.body).toMatchObject({ type: "feature_disabled" })
      expect(ctx.resolved).toEqual([])
    }
  })
})

describe("POST /admin/hawala/pools/:id/carrier (both flags on)", () => {
  beforeEach(() => {
    process.env[POOLS] = "true"
    process.env[PARITY] = "true"
  })

  it("every carrier refusal is forbidden(): 403 with ONE body for an unknown key and for each ineligible org; nothing is written", async () => {
    const orgs = [
      gulp({ key: "unpublished", published: false }),
      gulp({ key: "no_account", stripe_connect_account_id: null }),
      gulp({ key: "unverified_c3", verification_status: "unverified" }),
      gulp({ key: "revoked_c3", verification_status: "revoked" }),
      gulp({ key: "not_found_c3", verification_status: "not_found" }),
      gulp({ key: "pending_c3", verification_status: "pending" }),
    ]
    const bodies: Record<string, unknown>[] = []
    for (const key of ["does_not_exist", ...orgs.map((o) => o.key)]) {
      const ctx = makeCtx({ orgs })
      const { res, reached } = await throughGates(assignCarrier as unknown as Handler, ctx, { params: { id: "pool_1" }, body: { carrier_org_key: key } })
      expect(reached).toBe(true)
      expect(res.statusCode).toBe(403)
      bodies.push(res.body)
      // The directory was read; hawala was never touched.
      expect(ctx.resolved).toEqual([PARTNER_DIRECTORY_MODULE])
      expect(ctx.ledger.poolWrites).toEqual([])
      expect(ctx.ledger.pools[0].carrier_org_key).toBeNull()
    }
    for (const body of bodies) expect(body).toEqual(FORBIDDEN_BODY)
  })

  it("a verified, published org with a connected account is frozen into the pool — key, type, status, file date, account PRESENCE — and the response projects it", async () => {
    const ctx = makeCtx()
    const { res } = await throughGates(assignCarrier as unknown as Handler, ctx, { params: { id: "pool_1" }, body: { carrier_org_key: "ground_up_liberation_project" } })
    expect(res.statusCode).toBe(200)
    expect(ctx.resolved).toEqual([PARTNER_DIRECTORY_MODULE, HAWALA_LEDGER_MODULE])

    const pool = ctx.ledger.pools[0]
    expect(pool.carrier_org_key).toBe("ground_up_liberation_project")
    expect(pool.carrier_snapshot).toMatchObject({
      org_key: "ground_up_liberation_project",
      org_type: "irs_501c3",
      verification_status: "pub78_eligible",
      verified_as_of: AS_OF.toISOString(),
      stripe_connect_account_present: true,
    })
    expect(JSON.stringify(pool.carrier_snapshot)).not.toContain("acct_")
    expect(pool.ledger_account_id).toBe("acc-pool_1")
    expect(res.body).toMatchObject({
      carrier: { org_key: "ground_up_liberation_project", verification_status: "pub78_eligible", verified_as_of: AS_OF.toISOString() },
    })
  })

  it("a coop published with the operator's ack can carry; its snapshot has no file date", async () => {
    const ctx = makeCtx({ orgs: [gulp({ key: "detroit_food_coop", org_type: "coop", verification_status: "unverified", verified_as_of: null, stripe_connect_account_id: "acct_1COOP" })] })
    const { res } = await throughGates(assignCarrier as unknown as Handler, ctx, { params: { id: "pool_1" }, body: { carrier_org_key: "detroit_food_coop" } })
    expect(res.statusCode).toBe(200)
    expect(ctx.ledger.pools[0].carrier_snapshot).toMatchObject({ org_type: "coop", verification_status: "unverified", verified_as_of: null })
  })

  it("a pool holding funds on BMC's ledger is refused by the real service: 409 pool_has_ledger_funds", async () => {
    const ledger = makePoolLedger({
      pools: [makePool("pool_1", { total_raised: 120 })],
      accounts: [makePoolAccount("acc-pool_1", { balance: 120, available_balance: 120 })],
    })
    const ctx = makeCtx({ ledger })
    const { res } = await throughGates(assignCarrier as unknown as Handler, ctx, { params: { id: "pool_1" }, body: { carrier_org_key: "ground_up_liberation_project" } })
    expect(res.statusCode).toBe(409)
    expect(res.body).toMatchObject({ type: "pool_has_ledger_funds" })
    expect(ledger.pools[0].carrier_org_key).toBeNull()
  })

  it("an unknown pool is 404 (admin; no owner check, so no oracle), and a bad body is 400 — a snapshot or status in the body is an unknown key", async () => {
    const ctx = makeCtx()
    const missing = await call(assignCarrier as unknown as Handler, ctx, { params: { id: "pool_ghost" }, body: { carrier_org_key: "ground_up_liberation_project" } })
    expect(missing.statusCode).toBe(404)
    expect(missing.body).toMatchObject({ type: "not_found" })

    for (const body of [
      {},
      { carrier_org_key: "Not A Key" },
      { carrier_org_key: "ground_up_liberation_project", carrier_snapshot: { verification_status: "pub78_eligible" } },
      { carrier_org_key: "ground_up_liberation_project", verification_status: "pub78_eligible" },
    ]) {
      const fresh = makeCtx()
      const res = await call(assignCarrier as unknown as Handler, fresh, { params: { id: "pool_1" }, body })
      expect(res.statusCode).toBe(400)
      expect(res.body).toMatchObject({ type: "invalid_request" })
      expect(fresh.resolved).toEqual([])
    }
  })

  it("resolves both modules on their imported constants; a near-miss key throws instead of passing", async () => {
    const dirMiss = makeCtx({ keys: { directory: "partnerDirectoryService" } })
    await expect(call(assignCarrier as unknown as Handler, dirMiss, { params: { id: "pool_1" }, body: { carrier_org_key: "ground_up_liberation_project" } })).rejects.toThrow(
      `Could not resolve '${PARTNER_DIRECTORY_MODULE}'`
    )
    const hawalaMiss = makeCtx({ keys: { hawala: "hawala-ledger" } })
    await expect(call(assignCarrier as unknown as Handler, hawalaMiss, { params: { id: "pool_1" }, body: { carrier_org_key: "ground_up_liberation_project" } })).rejects.toThrow(
      `Could not resolve '${HAWALA_LEDGER_MODULE}'`
    )
    expect(hawalaMiss.ledger.poolWrites).toEqual([])
  })
})

describe("POST /admin/hawala/pools/:id/carrier-contributions and /carrier-distributions (both flags on)", () => {
  beforeEach(() => {
    process.env[POOLS] = "true"
    process.env[PARITY] = "true"
  })

  function carriedCtx() {
    const ledger = makePoolLedger({ pools: [carried("pool_c")], accounts: [makePoolAccount("acc-pool_c")] })
    return makeCtx({ ledger })
  }

  it("a contribution is a record: 201, CARRIER row with no account and no ledger entry, derived totals; the replay is 200 already_recorded", async () => {
    const ctx = carriedCtx()
    const first = await throughGates(recordContribution as unknown as Handler, ctx, { params: { id: "pool_c" }, body: { amount: 25.5, carrier_reference: "gulp-2026-10-04-001", customer_id: "cust_1" } })
    expect(first.res.statusCode).toBe(201)
    expect(first.res.body).toMatchObject({ recorded: true, totals: { total_raised: 25.5, total_investors: 1, total_distributed: 0 } })
    expect(ctx.ledger.investments[0]).toMatchObject({ settlement: "CARRIER", investor_account_id: null, ledger_entry_id: null, carrier_reference: "gulp-2026-10-04-001" })
    expect(ctx.ledger.entries).toEqual([])
    expect(ctx.ledger.balanceMoves).toEqual([])

    const replay = await throughGates(recordContribution as unknown as Handler, ctx, { params: { id: "pool_c" }, body: { amount: 25.5, carrier_reference: "gulp-2026-10-04-001" } })
    expect(replay.res.statusCode).toBe(200)
    expect(replay.res.body).toEqual({ recorded: false, reason: "already_recorded", investment_id: "inv_1" })
    expect(ctx.ledger.investments).toHaveLength(1)
    expect(ctx.resolved).toEqual([HAWALA_LEDGER_MODULE, HAWALA_LEDGER_MODULE])
  })

  it("a distribution is a record: 201, then 200 on replay; total_distributed derived; distributeDividends-style allocation never happens", async () => {
    const ctx = carriedCtx()
    await throughGates(recordContribution as unknown as Handler, ctx, { params: { id: "pool_c" }, body: { amount: 100, carrier_reference: "in" } })
    const first = await throughGates(recordDistribution as unknown as Handler, ctx, { params: { id: "pool_c" }, body: { amount: 12.25, carrier_reference: "out-1", distributed_at: "2026-10-03T00:00:00Z" } })
    expect(first.res.statusCode).toBe(201)
    expect(first.res.body).toMatchObject({ recorded: true, totals: { total_raised: 100, total_distributed: 12.25 } })
    expect(ctx.ledger.distributions[0]).toMatchObject({ carrier_reference: "out-1", amount: 12.25, distributed_at: new Date("2026-10-03T00:00:00Z") })
    const replay = await throughGates(recordDistribution as unknown as Handler, ctx, { params: { id: "pool_c" }, body: { amount: 12.25, carrier_reference: "out-1" } })
    expect(replay.res.statusCode).toBe(200)
    expect(replay.res.body).toMatchObject({ recorded: false, reason: "already_recorded" })
    expect(ctx.ledger.entries).toEqual([])
    expect(ctx.ledger.pools[0].total_distributed).toBe(12.25)
  })

  it("an uncarried pool is 409 no_carrier; a bad amount, a missing reference or an unknown key is 400 before hawala is resolved", async () => {
    const ctx = makeCtx()
    const res = await throughGates(recordContribution as unknown as Handler, ctx, { params: { id: "pool_1" }, body: { amount: 10, carrier_reference: "r" } })
    expect(res.res.statusCode).toBe(409)
    expect(res.res.body).toMatchObject({ type: "no_carrier" })
    expect(ctx.ledger.investments).toEqual([])

    for (const body of [{ amount: -1, carrier_reference: "r" }, { amount: 1.005, carrier_reference: "r" }, { amount: 10 }, { amount: 10, carrier_reference: "r", investor_account_id: "acc" }]) {
      const fresh = carriedCtx()
      const out = await call(recordContribution as unknown as Handler, fresh, { params: { id: "pool_c" }, body })
      expect(out.statusCode).toBe(400)
      expect(fresh.resolved).toEqual([])
      const dist = await call(recordDistribution as unknown as Handler, fresh, { params: { id: "pool_c" }, body })
      expect(dist.statusCode).toBe(400)
      expect(fresh.resolved).toEqual([])
    }
  })
})

describe("POST /store/hawala/investments", () => {
  const invest = (ctx: Ctx, poolId: string) =>
    call(storeInvest as unknown as Handler, ctx, { auth_context: { actor_id: "cust_1" }, headers: {}, body: { pool_id: poolId, amount: 50 } })

  it("a carried pool is 409 carried_pool naming the carrier, before any wallet or balance read — flag on or off", async () => {
    for (const flag of [undefined, "true"]) {
      if (flag) process.env[PARITY] = flag
      const ledger = makePoolLedger({ pools: [carried("pool_c")], accounts: [makeAccount("acc-wallet"), makePoolAccount("acc-pool_c")] })
      const walletReads = jest.fn(async () => [])
      ;(ledger.service as unknown as Record<string, unknown>).listLedgerAccounts = walletReads
      const ctx = makeCtx({ ledger })
      const res = await invest(ctx, "pool_c")
      expect(res.statusCode).toBe(409)
      expect(res.body).toEqual({
        type: "carried_pool",
        message: "This pool is carried by ground_up_liberation_project; contributions are collected by the carrier, not here.",
      })
      expect(walletReads).not.toHaveBeenCalled()
      expect(ledger.entries).toEqual([])
      expect(ledger.investments).toEqual([])
      delete process.env[PARITY]
    }
  })

  it("flag on + uncarried pool: the service's no_carrier refusal surfaces as 409 no_carrier and nothing moved", async () => {
    process.env[PARITY] = "true"
    const ctx = makeCtx()
    const res = await invest(ctx, "pool_1")
    expect(res.statusCode).toBe(409)
    expect(res.body).toMatchObject({ type: "no_carrier" })
    expect(ctx.ledger.entries).toEqual([])
    expect(ctx.ledger.balanceMoves).toEqual([])
    expect(ctx.ledger.investments).toEqual([])
  })

  it("flag off + uncarried pool: unchanged — 201, the wallet is debited and the pool credited", async () => {
    const ctx = makeCtx()
    const res = await invest(ctx, "pool_1")
    expect(res.statusCode).toBe(201)
    expect(ctx.ledger.entries).toHaveLength(1)
    expect(ctx.ledger.balanceMoves).toEqual([
      { accountId: "acc-wallet", delta: -50 },
      { accountId: "acc-pool_1", delta: 50 },
    ])
    expect(ctx.ledger.pools[0]).toMatchObject({ total_raised: 50, total_investors: 1 })
  })
})

describe("GET /store/hawala/investments", () => {
  it("summary.total_invested counts every LEDGER row exactly as before, but a CARRIER contribution only once CONFIRMED and unreversed (Decision 7)", async () => {
    const ledger = makePoolLedger({
      pools: [makePool("pool_1"), carried("pool_c")],
      investments: [
        { id: "l1", pool_id: "pool_1", customer_id: "cust_1", settlement: "LEDGER", status: "CONFIRMED", amount: 10, actual_return: 0 },
        { id: "l2", pool_id: "pool_1", customer_id: "cust_1", settlement: "LEDGER", status: "WITHDRAWN", amount: 20, actual_return: 0 },
        { id: "c1", pool_id: "pool_c", customer_id: "cust_1", settlement: "CARRIER", status: "CONFIRMED", amount: 5, reversed_at: null, actual_return: 0 },
        { id: "c2", pool_id: "pool_c", customer_id: "cust_1", settlement: "CARRIER", status: "PENDING", amount: 100, reversed_at: null, actual_return: 0 },
        { id: "c3", pool_id: "pool_c", customer_id: "cust_1", settlement: "CARRIER", status: "CANCELLED", amount: 200, reversed_at: null, actual_return: 0 },
        { id: "c4", pool_id: "pool_c", customer_id: "cust_1", settlement: "CARRIER", status: "CANCELLED", amount: 400, reversed_at: new Date(), actual_return: 0 },
      ],
      accounts: [makePoolAccount("acc-pool_1"), makePoolAccount("acc-pool_c")],
    })
    const ctx = makeCtx({ ledger })
    const res = await call(storeInvestments as unknown as Handler, ctx, { auth_context: { actor_id: "cust_1" } })
    expect(res.statusCode).toBe(200)
    expect(res.body.summary).toEqual({ total_invested: 35, total_returns: 0, active_investments: 2 })
    // The rows themselves are all listed, each with its own status.
    expect((res.body.investments as unknown[]).length).toBe(6)
  })
})

describe("POST /vendor/hawala/pools/:id/withdraw", () => {
  it("a carried pool is 409 carried_pool before any balance read, earnings-account creation or transfer", async () => {
    const ledger = makePoolLedger({ pools: [carried("pool_c", { producer_id: "sel_1" })], accounts: [makePoolAccount("acc-pool_c")] })
    const svc = ledger.service as unknown as Record<string, unknown>
    const balanceRead = jest.fn(async () => ({ available_balance: 1000 }))
    const accountReads = jest.fn(async () => [])
    const accountCreate = jest.fn(async () => ({ id: "acc-new" }))
    svc.getAccountBalance = balanceRead
    svc.listLedgerAccounts = accountReads
    svc.createAccount = accountCreate
    const ctx = makeCtx({ ledger })
    const res = await call(vendorWithdraw as unknown as Handler, ctx, { params: { id: "pool_c" }, _seller_id: "sel_1", auth_context: { actor_id: "sel_1" }, headers: {}, body: { amount: 25 } })
    expect(res.statusCode).toBe(409)
    expect(res.body).toMatchObject({ type: "carried_pool", message: expect.stringContaining("ground_up_liberation_project") })
    expect(balanceRead).not.toHaveBeenCalled()
    expect(accountReads).not.toHaveBeenCalled()
    expect(accountCreate).not.toHaveBeenCalled()
    expect(ledger.entries).toEqual([])
  })

  it("an uncarried pool still withdraws as before", async () => {
    const ledger = makePoolLedger({
      pools: [makePool("pool_1", { producer_id: "sel_1" })],
      accounts: [makePoolAccount("acc-pool_1", { balance: 100, available_balance: 100 }), makeAccount("acc-earn", { account_type: "SELLER_EARNINGS", owner_type: "SELLER", owner_id: "sel_1", balance: 0, available_balance: 0 })],
    })
    const ctx = makeCtx({ ledger })
    const res = await call(vendorWithdraw as unknown as Handler, ctx, { params: { id: "pool_1" }, _seller_id: "sel_1", auth_context: { actor_id: "sel_1" }, headers: {}, body: { amount: 25 } })
    expect(res.statusCode).toBe(200)
    expect(ledger.entries).toHaveLength(1)
    expect(ledger.entries[0]).toMatchObject({ entry_type: "WITHDRAWAL", debit_account_id: "acc-pool_1", credit_account_id: "acc-earn", amount: 25 })
  })
})

describe("GET /store/hawala/pools", () => {
  it("a carried pool carries `carrier` and a null current_balance; an uncarried pool is unchanged", async () => {
    const ledger = makePoolLedger({
      pools: [makePool("pool_u", { total_raised: 30 }), carried("pool_c")],
      accounts: [makePoolAccount("acc-pool_u", { balance: 30, available_balance: 30 }), makePoolAccount("acc-pool_c")],
    })
    const ctx = makeCtx({ ledger })
    const res = createRes()
    await (storePools as unknown as Handler)({ query: {}, scope: ctx.scope } as never, res as never)
    expect(res.statusCode).toBe(200)
    const pools = res.body.pools as Array<Record<string, unknown>>
    expect(pools[0]).toMatchObject({ id: "pool_u", carrier: null, current_balance: 30 })
    expect(pools[1]).toMatchObject({
      id: "pool_c",
      carrier: { org_key: "ground_up_liberation_project", verification_status: "pub78_eligible", verified_as_of: AS_OF.toISOString() },
      current_balance: null,
    })
  })
})
