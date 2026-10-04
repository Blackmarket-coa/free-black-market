jest.mock("stripe", () => ({ __esModule: true, default: jest.fn() }))

import fs from "fs"
import path from "path"
import Stripe from "stripe"
import { Modules } from "@medusajs/framework/utils"
import { POST, carriedPoolDisclosure, type PoolContributionResponse } from "../[id]/contributions/route"
import { DONATION_MODULE } from "../../../../../modules/donation"
import { HAWALA_LEDGER_MODULE } from "../../../../../modules/hawala-ledger"
import { PARTNER_DIRECTORY_MODULE } from "../../../../../modules/partner-directory"
import { PAYOUT_BREAKDOWN_MODULE } from "../../../../../modules/payout-breakdown"
import PayoutBreakdownService from "../../../../../modules/payout-breakdown/service"
import StripeConnectDirectProviderService from "../../../../../modules/stripe-connect-direct/service"
import { STRIPE_CONNECT_DIRECT_PROVIDER_ID } from "../../../../../modules/stripe-connect-direct/registration"
import { PHASE0_FEATURE_FLAGS } from "../../../../../shared/feature-flags"
import { requireFeatureFlagMiddleware } from "../../../../../shared/runtime-module-gates"
import { DIRECT_CHARGE_CONTEXT_KEY, FORBIDDEN_DIRECT_CHARGE_PARAMS } from "../../../../../shared/stripe-direct-charge"
import { makeInMemoryDirectory, type InMemoryDirectory, type OrgRow } from "../../../../../modules/partner-directory/__tests__/in-memory-partner-orgs"
import { makeInMemoryDonations, type InMemoryDonations } from "../../../../../modules/donation/__tests__/in-memory-donation-splits"
import { makeAccount, makePool, makePoolAccount, makePoolLedger, type PoolLedger, type Row } from "../../../../../modules/hawala-ledger/__tests__/in-memory-pool-ledger"

/**
 * `POST /store/hawala/pools/:id/contributions` against the REAL pieces: the
 * real partner-directory service (prototype + shadowed CRUD), the real fee
 * chain (`resolveTransactionPlatformFee` → real `PayoutBreakdownService` →
 * `resolvePlatformFee`), a fake payment module that delegates to the REAL
 * `stripe_connect_direct` provider over a mocked Stripe SDK, the real
 * hawala-ledger service (prototype + shadowed CRUD, so the carrier rules and
 * derived totals are the code that ships), and the real
 * `requireFeatureFlagMiddleware` for BOTH flags. Every module is keyed on its
 * imported constant and the scope throws on anything else (CLAUDE.md rule 2).
 *
 * Pinned (docs/BMC_SURVIVAL_PROGRAMS.md Decision 7; L26, L24, L11, L3):
 *   - dark through the real middleware when EITHER flag is off, and the
 *     handler repeats both checks; 503 without the provider; nothing resolved;
 *   - a revoked / unpublished / account-less / missing carrier cannot take
 *     money even though the pool's frozen snapshot says eligible: forbidden(),
 *     403, ONE body, nothing minted, nothing recorded;
 *   - an uncarried pool is 409 no_carrier; a carried pool that is not open is
 *     409 pool_not_open; amount bounds are 400; nothing minted for any of them;
 *   - the fee rung is consulted for kind pool_contribution and 0 by
 *     transaction_kind is asserted before minting;
 *   - processor first: ONE intent ON the carrier's connected account with the
 *     server-set marker { kind pool_contribution, pool_id }, metadata
 *     fbm_pool_id, none of transfer_data / on_behalf_of /
 *     application_fee_amount, no transfers.create;
 *   - record second: a PENDING CARRIER row on hawala_investment keyed by the
 *     intent id — NOT donation_split_record (the donation module is never
 *     resolved), no ledger entry, no account, totals unchanged (a PENDING row
 *     counts for nothing);
 *   - guests allowed with customer_id null and a per-request nonce; a retry
 *     with the same Idempotency-Key reuses the intent and the row;
 *   - near-miss module keys throw.
 */

const PARITY = PHASE0_FEATURE_FLAGS.NONPROFIT_PARITY_V1
const POOLS = PHASE0_FEATURE_FLAGS.INVESTMENT_POOLS_V1
const ENV_KEYS = [PARITY, POOLS, "STRIPE_CONNECT_DIRECT_ENABLED", "STRIPE_API_KEY"]
const AS_OF = new Date("2026-09-10T09:18:37Z")
const ACCT = "acct_1GULP"

const StripeCtor = Stripe as unknown as jest.Mock

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

type Req = Parameters<typeof POST>[0]
type Res = Parameters<typeof POST>[1]

const gulp = (over: Partial<OrgRow> = {}): Partial<OrgRow> & { key: string; name: string } => ({
  key: "ground_up_liberation_project",
  name: "Ground Up Liberation Project",
  org_type: "irs_501c3",
  ein: "123456789",
  verification_status: "pub78_eligible",
  verified_as_of: AS_OF,
  stripe_connect_account_id: ACCT,
  published: true,
  ...over,
})

/** A pool whose FROZEN snapshot says the carrier was eligible when assigned. */
const carried = (id = "pool_c", over: Partial<Row> = {}): Row =>
  makePool(id, {
    carrier_org_key: "ground_up_liberation_project",
    carrier_snapshot: {
      org_key: "ground_up_liberation_project",
      org_type: "irs_501c3",
      verification_status: "pub78_eligible",
      verified_as_of: AS_OF.toISOString(),
      stripe_connect_account_present: true,
      snapshot_at: "2026-10-04T12:00:00.000Z",
    },
    minimum_investment: 5,
    maximum_investment: 500,
    ...over,
  })

function makePayouts(opts: { defaultPercent?: number; forceDetail?: { percent: number; source: string } } = {}) {
  const svc = Object.create(PayoutBreakdownService.prototype) as Record<string, unknown>
  svc.listPayoutConfigs = (async () => [{ id: "pc_1", is_default: true, platform_fee_percent: opts.defaultPercent ?? 3 }]) as never
  svc.listSellerPayoutSettings = (async () => []) as never
  if (opts.forceDetail) {
    svc.getPlatformFeeDetail = (async () => ({ ...opts.forceDetail, override_expired: false, override_reason: null })) as never
  }
  return svc as unknown as PayoutBreakdownService
}

type FakeStripe = { paymentIntents: { create: jest.Mock }; transfers: { create: jest.Mock }; seenKeys: Map<string, { params: string; intent: Record<string, unknown> }> }

const stripeIdempotencyError = () =>
  Object.assign(new Error("Keys for idempotent requests can only be used with the same parameters they were first used with."), {
    type: "StripeIdempotencyError",
    rawType: "idempotency_error",
    statusCode: 400,
  })

/** The payment module's `createPaymentSession` shape, delegating to the REAL provider. */
function makePaymentModule(stripe: FakeStripe) {
  StripeCtor.mockImplementation(() => stripe)
  const provider = new StripeConnectDirectProviderService({}, { apiKey: "sk_test_platform" })
  let n = 0
  const createPaymentCollections = jest.fn(async (input: Record<string, unknown>) => ({ id: `paycol_${++n}`, ...input }))
  const createPaymentSession = jest.fn(async (collectionId: string, input: Record<string, unknown>) => {
    if (input.provider_id !== STRIPE_CONNECT_DIRECT_PROVIDER_ID) {
      throw new Error(`Payment provider ${String(input.provider_id)} is not registered`)
    }
    const sessionId = `payses_${n}`
    const out = await provider.initiatePayment({
      amount: input.amount as string,
      currency_code: input.currency_code as string,
      data: { ...(input.data as Record<string, unknown>), session_id: sessionId },
      context: { idempotency_key: sessionId, ...(input.context as Record<string, unknown>) },
    })
    return { id: sessionId, payment_collection_id: collectionId, provider_id: input.provider_id, data: { ...(input.data as Record<string, unknown>), ...out.data }, status: out.status }
  })
  return { createPaymentCollections, createPaymentSession }
}

/** A Stripe fake WITH idempotency semantics. */
function makeStripe(): FakeStripe {
  let n = 0
  const seenKeys: FakeStripe["seenKeys"] = new Map()
  return {
    seenKeys,
    paymentIntents: {
      create: jest.fn(async (params: Record<string, unknown>, options: Record<string, unknown>) => {
        const key = typeof options.idempotencyKey === "string" ? options.idempotencyKey : null
        const serialised = JSON.stringify({ params, stripeAccount: options.stripeAccount })
        if (key) {
          const seen = seenKeys.get(key)
          if (seen && seen.params !== serialised) throw stripeIdempotencyError()
          if (seen) return seen.intent
        }
        const intent = {
          id: `pi_${++n}`,
          object: "payment_intent",
          status: "requires_payment_method",
          amount: params.amount,
          currency: params.currency,
          client_secret: `pi_${n}_secret`,
          transfer_data: null,
          on_behalf_of: null,
          application_fee_amount: null,
          metadata: params.metadata,
        }
        if (key) seenKeys.set(key, { params: serialised, intent })
        return intent
      }),
    },
    transfers: { create: jest.fn() },
  }
}

type Ctx = {
  scope: { resolve: <T>(key: string) => T }
  resolved: string[]
  dir: InMemoryDirectory
  dons: InMemoryDonations
  ledger: PoolLedger
  payment: ReturnType<typeof makePaymentModule>
  stripe: FakeStripe
}

function makeCtx(
  opts: {
    orgs?: Array<Partial<OrgRow> & { key: string; name: string }>
    ledger?: PoolLedger
    payouts?: PayoutBreakdownService
    stripe?: FakeStripe
    keys?: { directory?: string; hawala?: string }
  } = {}
): Ctx {
  const dir = makeInMemoryDirectory(opts.orgs ?? [gulp()])
  const dons = makeInMemoryDonations()
  const ledger = opts.ledger ?? makePoolLedger({ pools: [carried()], accounts: [makeAccount("acc-wallet"), makePoolAccount("acc-pool_c")] })
  const payouts = opts.payouts ?? makePayouts()
  const stripe = opts.stripe ?? makeStripe()
  const payment = makePaymentModule(stripe)
  const directoryKey = opts.keys?.directory ?? PARTNER_DIRECTORY_MODULE
  const hawalaKey = opts.keys?.hawala ?? HAWALA_LEDGER_MODULE
  const resolved: string[] = []
  const scope = {
    resolve: <T,>(key: string): T => {
      resolved.push(key)
      if (key === directoryKey) return dir.service as unknown as T
      if (key === hawalaKey) return ledger.service as unknown as T
      if (key === DONATION_MODULE) return dons.service as unknown as T
      if (key === PAYOUT_BREAKDOWN_MODULE) return payouts as unknown as T
      if (key === Modules.PAYMENT) return payment as unknown as T
      throw new Error(`Could not resolve '${key}'`)
    },
  }
  return { scope, resolved, dir, dons, ledger, payment, stripe }
}

type ReqShape = { params?: Record<string, string>; body?: unknown; headers?: Record<string, string>; customerId?: string }

function buildReq(ctx: Ctx, req: ReqShape): Req {
  return {
    params: req.params ?? { id: "pool_c" },
    body: req.body,
    headers: req.headers ?? {},
    scope: ctx.scope,
    auth_context: req.customerId ? { actor_id: req.customerId, actor_type: "customer" } : undefined,
  } as unknown as Req
}

async function call(ctx: Ctx, req: ReqShape) {
  const res = createRes()
  await POST(buildReq(ctx, req), res as unknown as Res)
  return res
}

/** The route as registered: both real flag middlewares, then the handler. */
async function throughGates(ctx: Ctx, req: ReqShape) {
  const res = createRes()
  const request = buildReq(ctx, req)
  let reached = false
  await requireFeatureFlagMiddleware("INVESTMENT_POOLS_V1")(request, res as never, async () => {
    await requireFeatureFlagMiddleware("NONPROFIT_PARITY_V1")(request, res as never, async () => {
      reached = true
      await POST(request, res as unknown as Res)
    })
  })
  return { res, reached }
}

const FORBIDDEN_BODY = { message: "You do not have access to this record.", type: "not_allowed" }
const BODY = { amount_cents: 2500 }

const enable = () => {
  process.env[PARITY] = "true"
  process.env[POOLS] = "true"
  process.env.STRIPE_CONNECT_DIRECT_ENABLED = "true"
  process.env.STRIPE_API_KEY = "sk_test_platform"
}

afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k]
})

describe("gating — dark unless both flags are on", () => {
  it("both unset: 404 feature_disabled naming FF_INVESTMENT_POOLS_V1 through the real middleware; handler never reached; nothing resolved", async () => {
    process.env.STRIPE_CONNECT_DIRECT_ENABLED = "true"
    process.env.STRIPE_API_KEY = "sk_test_platform"
    const ctx = makeCtx()
    const { res, reached } = await throughGates(ctx, { body: BODY })
    expect(res.statusCode).toBe(404)
    expect(res.body).toMatchObject({ type: "feature_disabled", message: expect.stringContaining(POOLS) })
    expect(reached).toBe(false)
    expect(ctx.resolved).toEqual([])
    expect(ctx.stripe.paymentIntents.create).not.toHaveBeenCalled()
  })

  it("INVESTMENT_POOLS_V1 alone: 404 naming FF_NONPROFIT_PARITY_V1; NONPROFIT_PARITY_V1 alone: 404 through the pools glob", async () => {
    process.env[POOLS] = "true"
    const a = await throughGates(makeCtx(), { body: BODY })
    expect(a.res.statusCode).toBe(404)
    expect(a.res.body).toMatchObject({ type: "feature_disabled", message: expect.stringContaining(PARITY) })
    expect(a.reached).toBe(false)
    delete process.env[POOLS]

    process.env[PARITY] = "true"
    const b = await throughGates(makeCtx(), { body: BODY })
    expect(b.res.statusCode).toBe(404)
    expect(b.res.body).toMatchObject({ type: "feature_disabled", message: expect.stringContaining(POOLS) })
    expect(b.reached).toBe(false)
  })

  it("the handler repeats both checks itself (a matcher typo cannot open it)", async () => {
    process.env.STRIPE_CONNECT_DIRECT_ENABLED = "true"
    process.env.STRIPE_API_KEY = "sk_test_platform"
    for (const set of [[], [POOLS], [PARITY]]) {
      for (const k of set) process.env[k] = "true"
      const ctx = makeCtx()
      const res = await call(ctx, { body: BODY })
      expect(res.statusCode).toBe(404)
      expect(res.body).toMatchObject({ type: "feature_disabled" })
      expect(ctx.resolved).toEqual([])
      delete process.env[POOLS]
      delete process.env[PARITY]
    }
  })

  it("answers 503 when the provider is not registered (both flags on, Stripe env unset) and resolves nothing", async () => {
    process.env[PARITY] = "true"
    process.env[POOLS] = "true"
    const ctx = makeCtx()
    const res = await call(ctx, { body: BODY })
    expect(res.statusCode).toBe(503)
    expect(res.body).toMatchObject({ type: "pool_contributions_unavailable" })
    expect(ctx.resolved).toEqual([])
  })

  it("is covered by the /store/hawala/pools* INVESTMENT_POOLS_V1 glob (express 4's * spans segments) and by its own NONPROFIT_PARITY_V1 matcher", () => {
    const source = fs.readFileSync(path.resolve(__dirname, "../../../../middlewares.ts"), "utf8")
    const block = source.split(/\n\s*\{\s*\n/).find((b) => b.includes('matcher: "/store/hawala/pools/*/contributions"'))
    expect(block).toBeDefined()
    expect(block).toContain('method: "POST"')
    expect(block).toContain('requireFeatureFlagMiddleware("NONPROFIT_PARITY_V1")')
    expect(block).toContain("standardRateLimiter")

    const pathToRegexp = require(require.resolve("path-to-regexp", { paths: [require.resolve("express")] })) as (p: string, keys: unknown[], opts: Record<string, unknown>) => RegExp
    expect(pathToRegexp("/store/hawala/pools*", [], {}).test("/store/hawala/pools/pool_c/contributions")).toBe(true)
    expect(pathToRegexp("/store/hawala/pools/*/contributions", [], {}).test("/store/hawala/pools/pool_c/contributions")).toBe(true)
    expect(pathToRegexp("/store/hawala/pools/*/contributions", [], {}).test("/store/hawala/pools/pool_c")).toBe(false)
  })

  it("rejects a malformed body with 400 before touching any module", async () => {
    enable()
    const ctx = makeCtx()
    for (const body of [{}, { amount_cents: 12.5 }, { amount_cents: 10 }, { amount_cents: 2500, transfer_data: { destination: "acct_X" } }, { amount_cents: 2500, currency_code: "eur" }, { amount_cents: 2500, pool_id: "pool_c" }]) {
      const res = await call(ctx, { body })
      expect(res.statusCode).toBe(400)
      expect(res.body.type).toBe("invalid_request")
    }
    expect(ctx.resolved).toEqual([])
  })
})

describe("the carrier is re-verified NOW — every refusal is forbidden(), 403, one body, nothing minted", () => {
  beforeEach(enable)

  const refusals: Array<[string, Array<Partial<OrgRow> & { key: string; name: string }>]> = [
    ["missing org (the frozen snapshot names a key the directory no longer has)", []],
    ["unpublished", [gulp({ published: false })]],
    ["no connected account", [gulp({ stripe_connect_account_id: null })]],
    ["revoked 501c3", [gulp({ verification_status: "revoked" })]],
    ["not_found 501c3", [gulp({ verification_status: "not_found" })]],
    ["unverified 501c3", [gulp({ verification_status: "unverified", verified_as_of: null })]],
    ["pending 501c3", [gulp({ verification_status: "pending" })]],
  ]

  it.each(refusals)("refuses %s with the same 403 although the pool's snapshot says eligible", async (_label, orgs) => {
    const ctx = makeCtx({ orgs })
    expect(ctx.ledger.pools[0].carrier_snapshot).toMatchObject({ verification_status: "pub78_eligible", stripe_connect_account_present: true })
    const { res, reached } = await throughGates(ctx, { body: BODY, customerId: "cus_42" })
    expect(reached).toBe(true)
    expect(res.statusCode).toBe(403)
    expect(res.body).toEqual(FORBIDDEN_BODY)
    expect(ctx.stripe.paymentIntents.create).not.toHaveBeenCalled()
    expect(ctx.payment.createPaymentCollections).not.toHaveBeenCalled()
    expect(ctx.ledger.investments).toEqual([])
    expect(ctx.dons.rows).toEqual([])
    // The pool was read, the directory was read; the fee rung and the payment module never.
    expect(ctx.resolved).toEqual([HAWALA_LEDGER_MODULE, PARTNER_DIRECTORY_MODULE])
  })
})

describe("the pool must be carried and open", () => {
  beforeEach(enable)

  it("an unknown pool is 404; an uncarried pool is 409 no_carrier; nothing minted", async () => {
    const ctx = makeCtx({ ledger: makePoolLedger({ pools: [makePool("pool_u")], accounts: [makePoolAccount("acc-pool_u")] }) })
    const missing = await call(ctx, { params: { id: "pool_ghost" }, body: BODY })
    expect(missing.statusCode).toBe(404)
    expect(missing.body).toMatchObject({ type: "not_found" })
    const uncarried = await call(ctx, { params: { id: "pool_u" }, body: BODY })
    expect(uncarried.statusCode).toBe(409)
    expect(uncarried.body).toMatchObject({ type: "no_carrier" })
    expect(ctx.stripe.paymentIntents.create).not.toHaveBeenCalled()
    expect(ctx.ledger.investments).toEqual([])
    expect(ctx.resolved).toEqual([HAWALA_LEDGER_MODULE, HAWALA_LEDGER_MODULE])
  })

  it("a carried pool that is not accepting money is 409 pool_not_open: wrong status, before its window, after its window", async () => {
    const future = new Date(Date.now() + 86_400_000)
    const past = new Date(Date.now() - 86_400_000)
    for (const over of [{ status: "DRAFT" }, { status: "FUNDED" }, { status: "COMPLETED" }, { status: "CANCELLED" }, { fundraising_start: future }, { fundraising_end: past }]) {
      const ctx = makeCtx({ ledger: makePoolLedger({ pools: [carried("pool_c", over)], accounts: [makePoolAccount("acc-pool_c")] }) })
      const res = await call(ctx, { body: BODY })
      expect(res.statusCode).toBe(409)
      expect(res.body).toMatchObject({ type: "pool_not_open" })
      expect(ctx.stripe.paymentIntents.create).not.toHaveBeenCalled()
      // Refused on the pool alone: the directory is not consulted.
      expect(ctx.resolved).toEqual([HAWALA_LEDGER_MODULE])
    }
    for (const over of [{ status: "FUNDRAISING" }, { status: "ACTIVE", fundraising_start: past, fundraising_end: future }]) {
      const ctx = makeCtx({ ledger: makePoolLedger({ pools: [carried("pool_c", over)], accounts: [makePoolAccount("acc-pool_c")] }) })
      expect((await call(ctx, { body: BODY })).statusCode).toBe(201)
    }
  })

  it("respects minimum_investment and maximum_investment (400), in the pool's own major units", async () => {
    const ctx = makeCtx()
    const low = await call(ctx, { body: { amount_cents: 499 } })
    expect(low.statusCode).toBe(400)
    expect(low.body).toMatchObject({ type: "below_minimum" })
    const high = await call(ctx, { body: { amount_cents: 50_001 } })
    expect(high.statusCode).toBe(400)
    expect(high.body).toMatchObject({ type: "above_maximum" })
    expect(ctx.stripe.paymentIntents.create).not.toHaveBeenCalled()
    expect((await call(ctx, { body: { amount_cents: 500 } })).statusCode).toBe(201)
    expect((await call(ctx, { body: { amount_cents: 50_000 } })).statusCode).toBe(201)
  })
})

describe("the fee rung is asserted, not trusted", () => {
  beforeEach(enable)

  it("refuses with 409 fee_not_zero and mints nothing when the chain does not return 0 by transaction_kind", async () => {
    for (const forceDetail of [{ percent: 3, source: "platform_default" }, { percent: 0, source: "seller_override" }]) {
      const ctx = makeCtx({ payouts: makePayouts({ forceDetail }) })
      const res = await call(ctx, { body: BODY })
      expect(res.statusCode).toBe(409)
      expect(res.body).toMatchObject({ type: "fee_not_zero" })
      expect(ctx.stripe.paymentIntents.create).not.toHaveBeenCalled()
      expect(ctx.ledger.investments).toEqual([])
    }
  })

  it("the real chain with a non-zero platform default and no seller yields 0 for kind pool_contribution", async () => {
    const ctx = makeCtx({ payouts: makePayouts({ defaultPercent: 3 }) })
    const res = await call(ctx, { body: BODY })
    expect(res.statusCode).toBe(201)
    expect(res.body.bmc_fee_cents).toBe(0)
    expect(ctx.resolved).toContain(PAYOUT_BREAKDOWN_MODULE)
  })
})

describe("the happy path — processor first, record second, BMC holds nothing", () => {
  beforeEach(enable)

  it("mints ONE intent ON the carrier's account with the pool marker, then a PENDING CARRIER row keyed by the intent id; no donation record, no ledger leg, totals unmoved", async () => {
    const ctx = makeCtx()
    const res = await call(ctx, { body: BODY, customerId: "cus_42" })
    expect(res.statusCode).toBe(201)
    const body = res.body as unknown as PoolContributionResponse

    // Processor: one intent, { stripeAccount: the carrier }, no forbidden params, no transfer.
    expect(ctx.stripe.paymentIntents.create).toHaveBeenCalledTimes(1)
    const [params, options] = ctx.stripe.paymentIntents.create.mock.calls[0]
    expect(options).toMatchObject({ stripeAccount: ACCT, idempotencyKey: expect.any(String) })
    expect(params.amount).toBe(2500)
    expect(params.currency).toBe("usd")
    for (const forbidden of FORBIDDEN_DIRECT_CHARGE_PARAMS) expect(params).not.toHaveProperty(forbidden)
    expect(params.metadata).toMatchObject({
      fbm_kind: "pool_contribution",
      fbm_pool_id: "pool_c",
      fbm_org_key: "ground_up_liberation_project",
      fbm_customer_id: "cus_42",
      fbm_gross_cents: "2500",
      fbm_connected_account_id: ACCT,
    })
    expect(params.metadata).not.toHaveProperty("session_id")
    expect(ctx.stripe.transfers.create).not.toHaveBeenCalled()

    // The server-only channel carried the account, the kind and the pool.
    expect(ctx.payment.createPaymentSession).toHaveBeenCalledTimes(1)
    expect(ctx.payment.createPaymentSession.mock.calls[0][1]).toMatchObject({
      provider_id: STRIPE_CONNECT_DIRECT_PROVIDER_ID,
      currency_code: "usd",
      amount: "25.00",
      context: {
        idempotency_key: expect.any(String),
        [DIRECT_CHARGE_CONTEXT_KEY]: { connected_account_id: ACCT, org_key: "ground_up_liberation_project", kind: "pool_contribution", pool_id: "pool_c" },
      },
    })

    // Record: a PENDING CARRIER row, written second, keyed by the intent id.
    expect(ctx.ledger.investments).toHaveLength(1)
    expect(ctx.ledger.investments[0]).toMatchObject({
      pool_id: "pool_c",
      settlement: "CARRIER",
      status: "PENDING",
      amount: 25,
      customer_id: "cus_42",
      carrier_org_key: "ground_up_liberation_project",
      carrier_reference: "pi_1",
      investor_account_id: null,
      ledger_entry_id: null,
      reversed_at: null,
      metadata: { recorded_from: "checkout", payment_collection_id: "paycol_1", payment_session_id: "payses_1", stripe_account_id: ACCT, gross_cents: 2500 },
    })
    // A PENDING row counts for nothing: the webhook confirms it.
    expect(ctx.ledger.pools[0]).toMatchObject({ total_raised: 0, total_investors: 0 })
    // Nothing on BMC's books: no donation record, no ledger entry, no account, no balance.
    expect(ctx.dons.rows).toEqual([])
    expect(ctx.ledger.entries).toEqual([])
    expect(ctx.ledger.balanceMoves).toEqual([])
    expect(ctx.ledger.accounts).toHaveLength(2)
    expect(ctx.ledger.accounts[1]).toMatchObject({ account_type: "PRODUCER_POOL", balance: 0, available_balance: 0 })

    // Response: what the storefront needs.
    expect(body).toMatchObject({
      pool_id: "pool_c",
      pool_name: "Pool pool_c",
      carrier_org_key: "ground_up_liberation_project",
      carrier_org_name: "Ground Up Liberation Project",
      payment_collection_id: "paycol_1",
      payment_session_id: "payses_1",
      stripe_payment_intent_id: "pi_1",
      stripe_account_id: ACCT,
      client_secret: "pi_1_secret",
      currency_code: "usd",
      gross_cents: 2500,
      bmc_fee_cents: 0,
      carrier_verification_status: "pub78_eligible",
      carrier_verified_as_of: AS_OF.toISOString(),
      record_status: "PENDING",
      disclosure: carriedPoolDisclosure("Ground Up Liberation Project"),
    })
    expect(body.disclosure).toContain("never holds these funds and takes no fee")

    // The flow: pool, carrier, fee rung, payment, record — the donation module never.
    expect(ctx.resolved).toEqual([HAWALA_LEDGER_MODULE, PARTNER_DIRECTORY_MODULE, PAYOUT_BREAKDOWN_MODULE, Modules.PAYMENT])
    expect(ctx.resolved).not.toContain(DONATION_MODULE)
  })

  it("records a guest contribution with customer_id null", async () => {
    const ctx = makeCtx()
    const res = await call(ctx, { body: BODY })
    expect(res.statusCode).toBe(201)
    expect(ctx.ledger.investments[0].customer_id).toBeNull()
    expect(ctx.stripe.paymentIntents.create.mock.calls[0][0].metadata.fbm_customer_id).toBe("")
  })

  it("a retry with the same Idempotency-Key reuses the SAME intent and the same row (already_recorded); a different amount under the same key is a 409 conflict", async () => {
    const ctx = makeCtx()
    const headers = { "idempotency-key": "contributor-click-1" }
    const r1 = await call(ctx, { body: BODY, headers, customerId: "cus_42" })
    const r2 = await call(ctx, { body: BODY, headers, customerId: "cus_42" })
    expect(r1.statusCode).toBe(201)
    expect(r2.statusCode).toBe(201)
    expect(r2.body.stripe_payment_intent_id).toBe(r1.body.stripe_payment_intent_id)
    expect(r2.body.client_secret).toBe(r1.body.client_secret)
    expect(ctx.stripe.seenKeys.size).toBe(1)
    expect(ctx.ledger.investments).toHaveLength(1)

    const r3 = await call(ctx, { body: { amount_cents: 2600 }, headers, customerId: "cus_42" })
    expect(r3.statusCode).toBe(409)
    expect(r3.body).toMatchObject({ type: "pool_contribution_idempotency_conflict" })
    expect(ctx.ledger.investments).toHaveLength(1)
  })

  it("two GUESTS giving the same amount never share an intent; a signed-in contributor's fast retry does", async () => {
    const ctx = makeCtx()
    await call(ctx, { body: BODY })
    await call(ctx, { body: BODY })
    expect(ctx.stripe.seenKeys.size).toBe(2)
    expect(ctx.ledger.investments).toHaveLength(2)
    expect(ctx.ledger.investments[0].carrier_reference).not.toBe(ctx.ledger.investments[1].carrier_reference)

    const ctx2 = makeCtx()
    await call(ctx2, { body: BODY, customerId: "cus_42" })
    await call(ctx2, { body: BODY, customerId: "cus_42" })
    expect(ctx2.stripe.seenKeys.size).toBe(1)
    expect(ctx2.ledger.investments).toHaveLength(1)
  })

  it("a processor that returned a destination-charge shape is refused with 409 and no row is written", async () => {
    const stripe = makeStripe()
    stripe.paymentIntents.create.mockImplementation(async (params: Record<string, unknown>) => ({
      id: "pi_bad",
      object: "payment_intent",
      status: "requires_payment_method",
      amount: params.amount,
      currency: params.currency,
      client_secret: "s",
      transfer_data: { destination: ACCT },
      on_behalf_of: null,
      application_fee_amount: null,
      metadata: params.metadata,
    }))
    const ctx = makeCtx({ stripe })
    const res = await call(ctx, { body: BODY })
    expect(res.statusCode).toBe(409)
    expect(res.body).toMatchObject({ type: "direct_charge_invariant", code: "forbidden_intent_param" })
    expect(ctx.ledger.investments).toEqual([])
  })

  it("throws, not falls back, when a module is registered under a near-miss key", async () => {
    const hawalaMiss = makeCtx({ keys: { hawala: "hawala-ledger" } })
    await expect(call(hawalaMiss, { body: BODY })).rejects.toThrow(`Could not resolve '${HAWALA_LEDGER_MODULE}'`)
    expect(hawalaMiss.stripe.paymentIntents.create).not.toHaveBeenCalled()

    const dirMiss = makeCtx({ keys: { directory: "partnerDirectoryService" } })
    await expect(call(dirMiss, { body: BODY })).rejects.toThrow(`Could not resolve '${PARTNER_DIRECTORY_MODULE}'`)
    expect(dirMiss.stripe.paymentIntents.create).not.toHaveBeenCalled()
    expect(dirMiss.ledger.investments).toEqual([])
  })
})
