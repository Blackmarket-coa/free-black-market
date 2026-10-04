import fs from "fs"
import path from "path"
import { GET as designatedReport } from "../designated/route"
import { POST as designatedReturn } from "../[id]/designated-returns/route"
import { GET as adminSummary } from "../../summary/route"
import { POST as vendorWithdraw } from "../../../../vendor/hawala/pools/[id]/withdraw/route"
import { HAWALA_LEDGER_MODULE } from "../../../../../modules/hawala-ledger"
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
 * The designated-funds surfaces (docs/BMC_SURVIVAL_PROGRAMS.md Decision 8;
 * legal checkpoints L26, L3) against the REAL hawala-ledger service (prototype
 * + shadowed CRUD, so the direction rule, `returnDesignatedFunds` and
 * `listDesignatedPoolFunds` are the code that ships) and the real
 * `requireFeatureFlagMiddleware` for BOTH flags. The module is keyed on its
 * imported constant and the scope throws on anything else (CLAUDE.md rule 2).
 *
 * Pinned:
 *   - GET /admin/hawala/pools/designated and POST
 *     /admin/hawala/pools/:id/designated-returns are dark (404) when EITHER
 *     flag is off, the handlers repeat the parity check, their matchers exist
 *     and match, and Medusa's real route sorter registers the static
 *     `designated` segment ahead of the sibling `:id` route;
 *   - the report is the service's; the return is 201 then 200
 *     already_returned, names its operator, and maps every refusal to 409
 *     (carried pool, CARRIER row, not CONFIRMED, insufficient balance), a
 *     missing pool / investment to 404, a bad body to 400 before anything is
 *     resolved;
 *   - GET /admin/hawala/summary carries `designated_pool_funds` ONLY with
 *     FF_NONPROFIT_PARITY_V1 on; with it off the response has exactly its old
 *     keys and the report is never computed;
 *   - POST /vendor/hawala/pools/:id/withdraw: flag on + uncarried pool is 409
 *     designated_outbound_only before any balance read, account creation or
 *     transfer; a carried pool is still 409 carried_pool; flag off unchanged.
 */

const PARITY = PHASE0_FEATURE_FLAGS.NONPROFIT_PARITY_V1
const POOLS = PHASE0_FEATURE_FLAGS.INVESTMENT_POOLS_V1

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

const carrierSnapshot = {
  org_key: "ground_up_liberation_project",
  org_type: "irs_501c3",
  verification_status: "pub78_eligible",
  verified_as_of: "2026-09-10T09:18:37.000Z",
  stripe_connect_account_present: true,
  snapshot_at: "2026-10-04T12:00:00.000Z",
}

const ledgerInvestment = (id: string, over: Partial<Row> = {}): Row => ({
  id,
  pool_id: "pool_1",
  settlement: "LEDGER",
  status: "CONFIRMED",
  amount: 100,
  investor_account_id: "acc-w1",
  customer_id: "cust_1",
  carrier_reference: null,
  metadata: null,
  ...over,
})

/** An uncarried pool funded before the flag: 150 on its account, investments of 100 and 50. */
function legacyLedger(opts: { poolBalance?: number; pool?: Partial<Row>; investments?: Row[] } = {}): PoolLedger {
  const balance = opts.poolBalance ?? 150
  const ledger = makePoolLedger({
    pools: [makePool("pool_1", { producer_id: "sel_1", total_raised: 150, total_investors: 2, ...opts.pool })],
    investments: opts.investments ?? [ledgerInvestment("inv_a"), ledgerInvestment("inv_b", { amount: 50, investor_account_id: "acc-w2", customer_id: "cust_2" })],
    accounts: [
      makePoolAccount("acc-pool_1", { balance, available_balance: balance }),
      makeAccount("acc-w1", { balance: 0, available_balance: 0 }),
      makeAccount("acc-w2", { owner_id: "cust_2", balance: 0, available_balance: 0 }),
      makeAccount("acc-earn", { account_type: "SELLER_EARNINGS", owner_type: "SELLER", owner_id: "sel_1", balance: 0, available_balance: 0 }),
    ],
  })
  // The summary route also reads settlement batches; none here.
  ;(ledger.service as unknown as Record<string, unknown>).listSettlementBatches = async () => []
  return ledger
}

type Ctx = { scope: { resolve: <T>(key: string) => T }; resolved: string[]; ledger: PoolLedger }

function makeCtx(opts: { ledger?: PoolLedger; hawalaKey?: string } = {}): Ctx {
  const ledger = opts.ledger ?? legacyLedger()
  const hawalaKey = opts.hawalaKey ?? HAWALA_LEDGER_MODULE
  const resolved: string[] = []
  const scope = {
    resolve: <T,>(key: string): T => {
      resolved.push(key)
      if (key === hawalaKey) return ledger.service as unknown as T
      throw new Error(`Could not resolve '${key}'`)
    },
  }
  return { scope, resolved, ledger }
}

type ReqShape = {
  params?: Record<string, string>
  body?: unknown
  query?: Record<string, string>
  headers?: Record<string, string>
  auth_context?: { actor_id: string }
  _seller_id?: string
}

const ADMIN = { auth_context: { actor_id: "user_admin" } }

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

const enableBoth = () => {
  process.env[POOLS] = "true"
  process.env[PARITY] = "true"
}

afterEach(() => {
  delete process.env[PARITY]
  delete process.env[POOLS]
})

const routes: Array<[string, Handler, ReqShape]> = [
  ["designated report", designatedReport as unknown as Handler, { ...ADMIN }],
  ["designated return", designatedReturn as unknown as Handler, { ...ADMIN, params: { id: "pool_1" }, body: { investment_id: "inv_a" } }],
]

describe("gating — neither flag alone opens the designated routes", () => {
  it("both unset: 404 naming FF_INVESTMENT_POOLS_V1, handler never reached, nothing resolved", async () => {
    for (const [, handler, req] of routes) {
      const ctx = makeCtx()
      const { res, reached } = await throughGates(handler, ctx, req)
      expect(res.statusCode).toBe(404)
      expect(res.body).toMatchObject({ type: "feature_disabled", message: expect.stringContaining(POOLS) })
      expect(reached).toBe(false)
      expect(ctx.resolved).toEqual([])
    }
  })

  it("INVESTMENT_POOLS_V1 alone: 404 naming FF_NONPROFIT_PARITY_V1; NONPROFIT_PARITY_V1 alone: 404 through the pools matcher", async () => {
    for (const only of [POOLS, PARITY]) {
      process.env[only] = "true"
      for (const [, handler, req] of routes) {
        const ctx = makeCtx()
        const { res, reached } = await throughGates(handler, ctx, req)
        expect(res.statusCode).toBe(404)
        expect(res.body).toMatchObject({ type: "feature_disabled", message: expect.stringContaining(only === POOLS ? PARITY : POOLS) })
        expect(reached).toBe(false)
        expect(ctx.ledger.entries).toEqual([])
      }
      delete process.env[only]
    }
  })

  it("the handlers repeat the parity check themselves (a matcher typo cannot open them)", async () => {
    process.env[POOLS] = "true"
    for (const [, handler, req] of routes) {
      const ctx = makeCtx()
      const res = await call(handler, ctx, req)
      expect(res.statusCode).toBe(404)
      expect(res.body).toMatchObject({ type: "feature_disabled" })
      expect(ctx.resolved).toEqual([])
    }
  })

  it("both matchers exist with the parity gate, and the /admin/hawala/pools* INVESTMENT_POOLS_V1 glob covers both paths", () => {
    const source = fs.readFileSync(path.resolve(__dirname, "../../../../middlewares.ts"), "utf8")
    const blocks = source.split(/\n\s*\{\s*\n/)
    const report = blocks.find((b) => b.includes('matcher: "/admin/hawala/pools/designated"'))
    const returns = blocks.find((b) => b.includes('matcher: "/admin/hawala/pools/*/designated-returns"'))
    expect(report).toContain('method: "GET"')
    expect(report).toContain('requireFeatureFlagMiddleware("NONPROFIT_PARITY_V1")')
    expect(returns).toContain('method: "POST"')
    expect(returns).toContain('requireFeatureFlagMiddleware("NONPROFIT_PARITY_V1")')

    const pathToRegexp = require(require.resolve("path-to-regexp", { paths: [require.resolve("express")] })) as (p: string, keys: unknown[], opts: Record<string, unknown>) => RegExp
    expect(pathToRegexp("/admin/hawala/pools*", [], {}).test("/admin/hawala/pools/designated")).toBe(true)
    expect(pathToRegexp("/admin/hawala/pools*", [], {}).test("/admin/hawala/pools/pool_1/designated-returns")).toBe(true)
    expect(pathToRegexp("/admin/hawala/pools/designated", [], {}).test("/admin/hawala/pools/designated")).toBe(true)
    expect(pathToRegexp("/admin/hawala/pools/designated", [], {}).test("/admin/hawala/pools/pool_1")).toBe(false)
    expect(pathToRegexp("/admin/hawala/pools/*/designated-returns", [], {}).test("/admin/hawala/pools/pool_1/designated-returns")).toBe(true)
    expect(pathToRegexp("/admin/hawala/pools/*/designated-returns", [], {}).test("/admin/hawala/pools/pool_1")).toBe(false)
  })

  it("Medusa's real route sorter registers the static `designated` segment ahead of the sibling `:id` route", () => {
    const httpDir = path.dirname(require.resolve("@medusajs/framework/http"))
    const { RoutesSorter } = require(path.join(httpDir, "routes-sorter.js")) as {
      RoutesSorter: new (routes: Array<{ matcher: string; method: string }>) => { sort: () => Array<{ matcher: string }> }
    }
    const sorted = new RoutesSorter([
      { matcher: "/admin/hawala/pools/:id", method: "GET" },
      { matcher: "/admin/hawala/pools/:id/designated-returns", method: "POST" },
      { matcher: "/admin/hawala/pools/designated", method: "GET" },
    ]).sort()
    const order = sorted.map((r) => r.matcher)
    expect(order.indexOf("/admin/hawala/pools/designated")).toBeLessThan(order.indexOf("/admin/hawala/pools/:id"))
  })
})

describe("GET /admin/hawala/pools/designated (both flags on)", () => {
  beforeEach(enableBoth)

  it("answers the real service's report: uncarried pools holding legacy funds, with balance, outstanding investments and delta; carried pools left out", async () => {
    const ledger = legacyLedger()
    ledger.pools.push(makePool("pool_c", { carrier_org_key: "ground_up_liberation_project", carrier_snapshot: carrierSnapshot }))
    ledger.accounts.push(makePoolAccount("acc-pool_c", { balance: 9, available_balance: 9 }))
    const ctx = makeCtx({ ledger })
    const { res, reached } = await throughGates(designatedReport as unknown as Handler, ctx, { ...ADMIN })
    expect(reached).toBe(true)
    expect(res.statusCode).toBe(200)
    expect(ctx.resolved).toEqual([HAWALA_LEDGER_MODULE])
    expect(res.body).toEqual({
      pools: [
        {
          pool_id: "pool_1",
          name: "Pool pool_1",
          producer_id: "sel_1",
          status: "ACTIVE",
          ledger_account_id: "acc-pool_1",
          legacy_funds_designated_at: null,
          account_balance: 150,
          outstanding_ledger_investments: { count: 2, total: 150 },
          returnable_investments: 2,
          delta: 0,
        },
      ],
      totals: { pools: 1, account_balance: 150, outstanding_ledger_investments: 150, delta: 0 },
    })
  })

  it("resolves hawala on its imported constant; a near-miss key throws instead of passing", async () => {
    const ctx = makeCtx({ hawalaKey: "hawala-ledger" })
    await expect(call(designatedReport as unknown as Handler, ctx, { ...ADMIN })).rejects.toThrow(`Could not resolve '${HAWALA_LEDGER_MODULE}'`)
  })
})

describe("POST /admin/hawala/pools/:id/designated-returns (both flags on)", () => {
  beforeEach(enableBoth)

  const ret = (ctx: Ctx, investment_id: string, poolId = "pool_1") =>
    throughGates(designatedReturn as unknown as Handler, ctx, { ...ADMIN, params: { id: poolId }, body: { investment_id } })

  it("201 on the first return (one REFUND leg to the investor's wallet, investment WITHDRAWN, operator named), 200 already_returned on the replay", async () => {
    const ctx = makeCtx()
    const first = await ret(ctx, "inv_a")
    expect(first.res.statusCode).toBe(201)
    expect(first.res.body).toMatchObject({ returned: true, investment: { id: "inv_a", status: "WITHDRAWN", metadata: { returned_by: "user_admin" } } })
    expect(ctx.ledger.entries).toHaveLength(1)
    expect(ctx.ledger.entries[0]).toMatchObject({ entry_type: "REFUND", debit_account_id: "acc-pool_1", credit_account_id: "acc-w1", amount: 100, idempotency_key: "designated-return-inv_a" })

    const replay = await ret(ctx, "inv_a")
    expect(replay.res.statusCode).toBe(200)
    expect(replay.res.body).toEqual({ returned: false, reason: "already_returned", investment_id: "inv_a", entry_id: "le_1" })
    expect(ctx.ledger.entries).toHaveLength(1)
    expect(ctx.resolved).toEqual([HAWALA_LEDGER_MODULE, HAWALA_LEDGER_MODULE])
  })

  it("a ledger failure DURING the move is 409 designated_return_unsettled — never 200 already_returned — and the investment stays CONFIRMED with nothing moved", async () => {
    const ledger = legacyLedger()
    const shadow = ledger.service as unknown as Record<string, unknown>
    const realMove = shadow.updateBalances as (accountId: string, delta: number) => Promise<void>
    shadow.updateBalances = async (accountId: string, delta: number) => {
      if (accountId === "acc-w1") throw new Error("credit leg failed")
      return realMove(accountId, delta)
    }
    const ctx = makeCtx({ ledger })
    const first = await ret(ctx, "inv_a")
    expect(first.res.statusCode).toBe(409)
    expect(first.res.body).toMatchObject({ type: "designated_return_unsettled", details: { entry_status: "FAILED" } })
    expect(ledger.investments[0].status).toBe("CONFIRMED")
    expect(ledger.accounts.find((a) => a.id === "acc-pool_1")).toMatchObject({ balance: 150 })
    const again = await ret(ctx, "inv_a")
    expect(again.res.statusCode).toBe(409)
    expect(again.res.body).toMatchObject({ type: "designated_return_unsettled" })
  })

  it("400 for a malformed body — an amount, an account or a destination is an unknown key — before anything is resolved", async () => {
    for (const body of [{}, { investment_id: "" }, { investment_id: "inv_a", amount: 100 }, { investment_id: "inv_a", investor_account_id: "acc-earn" }, { investment_id: 7 }]) {
      const ctx = makeCtx()
      const res = await call(designatedReturn as unknown as Handler, ctx, { ...ADMIN, params: { id: "pool_1" }, body })
      expect(res.statusCode).toBe(400)
      expect(res.body).toMatchObject({ type: "invalid_request" })
      expect(ctx.resolved).toEqual([])
    }
  })

  it("401 without an admin actor: a return must name its operator; nothing is resolved", async () => {
    const ctx = makeCtx()
    const res = await call(designatedReturn as unknown as Handler, ctx, { params: { id: "pool_1" }, body: { investment_id: "inv_a" } })
    expect(res.statusCode).toBe(401)
    expect(ctx.resolved).toEqual([])
    expect(ctx.ledger.entries).toEqual([])
  })

  it("404 for an investment that is not in this pool and for an unknown pool", async () => {
    const ctx = makeCtx()
    const missing = await ret(ctx, "inv_ghost")
    expect(missing.res.statusCode).toBe(404)
    expect(missing.res.body).toMatchObject({ type: "not_found", message: "Investment not found" })
    const noPool = await ret(ctx, "inv_a", "pool_ghost")
    expect(noPool.res.statusCode).toBe(404)
    expect(noPool.res.body).toMatchObject({ type: "not_found", message: "Investment pool not found" })
    expect(ctx.ledger.entries).toEqual([])
  })

  it("409 with the refusal reason as `type` — carried pool, CARRIER row, not CONFIRMED, insufficient balance — and nothing moves", async () => {
    const cases: Array<[string, PoolLedger, string]> = [
      ["carried_pool", legacyLedger({ pool: { carrier_org_key: "ground_up_liberation_project", carrier_snapshot: carrierSnapshot } }), "inv_a"],
      ["not_ledger_investment", legacyLedger({ investments: [ledgerInvestment("inv_c", { settlement: "CARRIER", investor_account_id: null, carrier_reference: "pi_1" })] }), "inv_c"],
      ["investment_not_confirmed", legacyLedger({ investments: [ledgerInvestment("inv_a", { status: "PENDING" })] }), "inv_a"],
      ["insufficient_designated_balance", legacyLedger({ poolBalance: 30 }), "inv_a"],
    ]
    for (const [reason, ledger, investmentId] of cases) {
      const ctx = makeCtx({ ledger })
      const { res } = await ret(ctx, investmentId)
      expect(res.statusCode).toBe(409)
      expect(res.body).toMatchObject({ type: reason })
      expect(ledger.entries).toEqual([])
      expect(ledger.balanceMoves).toEqual([])
    }
  })
})

describe("GET /admin/hawala/summary", () => {
  it("flag off: no designated_pool_funds key — the response has exactly its old keys — and the report is never computed", async () => {
    const ledger = legacyLedger()
    const report = jest.spyOn(ledger.service, "listDesignatedPoolFunds")
    const ctx = makeCtx({ ledger })
    const res = await call(adminSummary as unknown as Handler, ctx, {})
    expect(res.statusCode).toBe(200)
    expect(Object.keys(res.body)).toEqual(["accounts", "investments", "settlements", "recent_entries"])
    expect(res.body).not.toHaveProperty("designated_pool_funds")
    expect(report).not.toHaveBeenCalled()
  })

  it("flag on: designated_pool_funds { pools, total } from the real report, beside the old keys", async () => {
    process.env[PARITY] = "true"
    const ledger = legacyLedger()
    ledger.pools.push(makePool("pool_2"))
    ledger.accounts.push(makePoolAccount("acc-pool_2", { balance: 12.34, available_balance: 12.34 }))
    const ctx = makeCtx({ ledger })
    const res = await call(adminSummary as unknown as Handler, ctx, {})
    expect(res.statusCode).toBe(200)
    expect(res.body.designated_pool_funds).toEqual({ pools: 2, total: 162.34 })
    expect(Object.keys(res.body)).toEqual(["accounts", "investments", "designated_pool_funds", "settlements", "recent_entries"])
  })
})

describe("POST /vendor/hawala/pools/:id/withdraw", () => {
  const withdraw = (ctx: Ctx, poolId = "pool_1") =>
    call(vendorWithdraw as unknown as Handler, ctx, { params: { id: poolId }, _seller_id: "sel_1", auth_context: { actor_id: "sel_1" }, headers: {}, body: { amount: 25 } })

  function spied(ledger: PoolLedger) {
    const svc = ledger.service as unknown as Record<string, unknown>
    const balanceRead = jest.fn(async () => ({ available_balance: 1000 }))
    const accountReads = jest.fn(async () => [])
    const accountCreate = jest.fn(async () => ({ id: "acc-new" }))
    const transfer = jest.fn(async () => ({ id: "le_x" }))
    svc.getAccountBalance = balanceRead
    svc.listLedgerAccounts = accountReads
    svc.createAccount = accountCreate
    svc.createTransfer = transfer
    return { balanceRead, accountReads, accountCreate, transfer }
  }

  it("flag on + an uncarried pool: 409 designated_outbound_only before any balance read, earnings-account creation or transfer", async () => {
    process.env[PARITY] = "true"
    const ledger = legacyLedger()
    const spies = spied(ledger)
    const res = await withdraw(makeCtx({ ledger }))
    expect(res.statusCode).toBe(409)
    expect(res.body).toMatchObject({ type: "designated_outbound_only" })
    expect(spies.balanceRead).not.toHaveBeenCalled()
    expect(spies.accountReads).not.toHaveBeenCalled()
    expect(spies.accountCreate).not.toHaveBeenCalled()
    expect(spies.transfer).not.toHaveBeenCalled()
  })

  it("flag on + a carried pool: still 409 carried_pool (that refusal comes first)", async () => {
    process.env[PARITY] = "true"
    const ledger = legacyLedger({ poolBalance: 0, pool: { carrier_org_key: "ground_up_liberation_project", carrier_snapshot: carrierSnapshot } })
    const res = await withdraw(makeCtx({ ledger }))
    expect(res.statusCode).toBe(409)
    expect(res.body).toMatchObject({ type: "carried_pool" })
    expect(ledger.entries).toEqual([])
  })

  it("flag off + an uncarried pool: unchanged — 200 and the WITHDRAWAL leg into the producer's earnings", async () => {
    const ledger = legacyLedger()
    const res = await withdraw(makeCtx({ ledger }))
    expect(res.statusCode).toBe(200)
    expect(ledger.entries).toHaveLength(1)
    expect(ledger.entries[0]).toMatchObject({ entry_type: "WITHDRAWAL", debit_account_id: "acc-pool_1", credit_account_id: "acc-earn", amount: 25 })
  })
})
