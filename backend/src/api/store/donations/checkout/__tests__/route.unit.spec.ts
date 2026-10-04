jest.mock("stripe", () => ({ __esModule: true, default: jest.fn() }))

import Stripe from "stripe"
import { Modules } from "@medusajs/framework/utils"
import { POST, PROCESSOR_FEE_DISCLOSURE, type DonationCheckoutResponse } from "../route"
import { DONATION_MODULE } from "../../../../../modules/donation"
import { HAWALA_LEDGER_MODULE } from "../../../../../modules/hawala-ledger"
import { PARTNER_DIRECTORY_MODULE } from "../../../../../modules/partner-directory"
import { PAYOUT_BREAKDOWN_MODULE } from "../../../../../modules/payout-breakdown"
import PayoutBreakdownService from "../../../../../modules/payout-breakdown/service"
import StripeConnectDirectProviderService from "../../../../../modules/stripe-connect-direct/service"
import { STRIPE_CONNECT_DIRECT_PROVIDER_ID } from "../../../../../modules/stripe-connect-direct/registration"
import { PHASE0_FEATURE_FLAGS } from "../../../../../shared/feature-flags"
import { DIRECT_CHARGE_CONTEXT_KEY, FORBIDDEN_DIRECT_CHARGE_PARAMS } from "../../../../../shared/stripe-direct-charge"
import {
  makeInMemoryDirectory,
  type InMemoryDirectory,
  type OrgRow,
} from "../../../../../modules/partner-directory/__tests__/in-memory-partner-orgs"
import { makeInMemoryDonations, type InMemoryDonations } from "../../../../../modules/donation/__tests__/in-memory-donation-splits"

/**
 * `POST /store/donations/checkout` against the REAL pieces: the real
 * partner-directory service (prototype + shadowed CRUD), the real fee chain
 * (`resolveTransactionPlatformFee` → real `PayoutBreakdownService` →
 * `resolvePlatformFee`), a fake payment module that delegates to the REAL
 * `stripe_connect_direct` provider over a mocked Stripe SDK, and the real
 * donation service with its guard. Every module is keyed on its imported
 * constant and the scope throws on anything else (CLAUDE.md rule 2).
 *
 * What is pinned (docs/POSTURE_A_COMPLIANCE.md rule 10):
 *   - dark with the flag off; 503 without the provider; nothing resolved;
 *   - every ineligible recipient is `forbidden()` — 403, one body — and no
 *     intent is minted for ANY org in the request;
 *   - the fee rung is consulted and 0 asserted before minting;
 *   - N orgs ⇒ N intents, each created with `{ stripeAccount: that org }`,
 *     none carrying transfer_data / on_behalf_of / application_fee_amount;
 *   - a record per intent with bmc_fee_cents 0 and the recipient snapshot;
 *   - the connected account reaches the provider in the session CONTEXT (the
 *     server-only channel), never only in `data`;
 *   - the hawala ledger is never resolved;
 *   - idempotency against a Stripe fake that HAS idempotency semantics (same
 *     key + same params ⇒ the same intent; same key + different params ⇒
 *     `idempotency_error`): a retry reuses the intent and the record, two
 *     guests never share a key, and a Stripe conflict is a 409.
 */

const FLAG = PHASE0_FEATURE_FLAGS.NONPROFIT_PARITY_V1
const ENV_KEYS = [FLAG, "STRIPE_CONNECT_DIRECT_ENABLED", "STRIPE_API_KEY"]
const AS_OF = new Date("2026-09-10T09:18:37Z")

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
  stripe_connect_account_id: "acct_1GULP",
  published: true,
  ...over,
})
const coop = (over: Partial<OrgRow> = {}): Partial<OrgRow> & { key: string; name: string } => ({
  key: "detroit_food_coop",
  name: "Detroit Food Co-op",
  org_type: "coop",
  verification_status: "unverified",
  stripe_connect_account_id: "acct_1COOP",
  published: true,
  ...over,
})

/** Real PayoutBreakdownService over a shadowed config row, as platform-fee-kind.unit.spec.ts does. */
function makePayouts(opts: { defaultPercent?: number; forceDetail?: { percent: number; source: string } } = {}) {
  const svc = Object.create(PayoutBreakdownService.prototype) as Record<string, unknown>
  svc.listPayoutConfigs = (async () => [{ id: "pc_1", is_default: true, platform_fee_percent: opts.defaultPercent ?? 3 }]) as never
  svc.listSellerPayoutSettings = (async () => []) as never
  if (opts.forceDetail) {
    // A broken rung, to prove the route checks the answer rather than trusts it.
    svc.getPlatformFeeDetail = (async () => ({ ...opts.forceDetail, override_expired: false, override_reason: null })) as never
  }
  return svc as unknown as PayoutBreakdownService
}

type FakeStripe = { paymentIntents: { create: jest.Mock }; transfers: { create: jest.Mock }; seenKeys: Map<string, { params: string; intent: Record<string, unknown> }> }

/** The error Stripe raises for a reused idempotency key with different params (stripe/cjs/Error.js). */
const stripeIdempotencyError = () =>
  Object.assign(new Error("Keys for idempotent requests can only be used with the same parameters they were first used with."), {
    type: "StripeIdempotencyError",
    rawType: "idempotency_error",
    statusCode: 400,
  })

/**
 * A payment module that does what Medusa's does for `createPaymentSession`:
 * mint a session id, then call the REAL provider's `initiatePayment` with the
 * module's own `{ idempotency_key: session.id, ...context }` and
 * `{ ...data, session_id }` shapes (payment-module.js `createPaymentSession`).
 */
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

/**
 * A Stripe fake WITH idempotency semantics, which is the part of Stripe the
 * route's retry story depends on: a key reused with identical params returns
 * the original intent; reused with different params it is `idempotency_error`.
 */
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
          // What the mock saw, so the test can read it back off the record's intent.
          __stripe_account_option: options.stripeAccount,
        }
        if (key) seenKeys.set(key, { params: serialised, intent })
        return intent
      }),
    },
    transfers: { create: jest.fn() },
  }
}

function makeScope(opts: { dir?: InMemoryDirectory; dons?: InMemoryDonations; payouts?: PayoutBreakdownService; stripe?: FakeStripe } = {}) {
  const dir = opts.dir ?? makeInMemoryDirectory([gulp(), coop()])
  const dons = opts.dons ?? makeInMemoryDonations()
  const payouts = opts.payouts ?? makePayouts()
  const stripe = opts.stripe ?? makeStripe()
  const payment = makePaymentModule(stripe)
  const hawala = { processOrderPayment: jest.fn(), createTransfer: jest.fn() }
  const resolved: string[] = []
  const scope = {
    resolve: (key: string) => {
      resolved.push(key)
      if (key === PARTNER_DIRECTORY_MODULE) return dir.service
      if (key === DONATION_MODULE) return dons.service
      if (key === PAYOUT_BREAKDOWN_MODULE) return payouts
      if (key === Modules.PAYMENT) return payment
      if (key === HAWALA_LEDGER_MODULE) return hawala
      throw new Error(`Could not resolve '${key}'`)
    },
  }
  return { scope, resolved, dir, dons, payment, stripe, hawala }
}

async function call(ctx: ReturnType<typeof makeScope>, body: unknown, extra: { headers?: Record<string, string>; customerId?: string } = {}) {
  const res = createRes()
  const req = {
    body,
    headers: extra.headers ?? {},
    scope: ctx.scope,
    auth_context: extra.customerId ? { actor_id: extra.customerId, actor_type: "customer" } : undefined,
  } as unknown as Req
  await POST(req, res as unknown as Res)
  return res
}

const enable = () => {
  process.env[FLAG] = "true"
  process.env.STRIPE_CONNECT_DIRECT_ENABLED = "true"
  process.env.STRIPE_API_KEY = "sk_test_platform"
}

afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k]
})

describe("POST /store/donations/checkout — dark paths", () => {
  it("answers 404 feature_disabled with the flag off and resolves nothing", async () => {
    process.env.STRIPE_CONNECT_DIRECT_ENABLED = "true"
    process.env.STRIPE_API_KEY = "sk_test_platform"
    const ctx = makeScope()
    const res = await call(ctx, { donations: [{ org_key: "ground_up_liberation_project", amount_cents: 2500 }] })
    expect(res.statusCode).toBe(404)
    expect(res.body).toMatchObject({ type: "feature_disabled" })
    expect(ctx.resolved).toEqual([])
    expect(ctx.stripe.paymentIntents.create).not.toHaveBeenCalled()
  })

  it("answers 503 when the provider is not registered (flag on, Stripe env unset) and resolves nothing", async () => {
    process.env[FLAG] = "true"
    const ctx = makeScope()
    const res = await call(ctx, { donations: [{ org_key: "ground_up_liberation_project", amount_cents: 2500 }] })
    expect(res.statusCode).toBe(503)
    expect(res.body).toMatchObject({ type: "direct_donations_unavailable" })
    expect(ctx.resolved).toEqual([])
  })

  it("rejects a malformed body with 400 before touching any module", async () => {
    enable()
    const ctx = makeScope()
    for (const body of [
      {},
      { donations: [] },
      { donations: [{ org_key: "ground_up_liberation_project", amount_cents: 12.5 }] },
      { donations: [{ org_key: "ground_up_liberation_project", amount_cents: 10 }] },
      { donations: [{ org_key: "ground_up_liberation_project", amount_cents: 2500, transfer_data: { destination: "acct_X" } }] },
      { donations: [{ org_key: "ground_up_liberation_project", amount_cents: 2500 }], currency_code: "eur" },
    ]) {
      const res = await call(ctx, body)
      expect(res.statusCode).toBe(400)
      expect(res.body.type).toBe("invalid_request")
    }
    expect(ctx.resolved).toEqual([])
  })
})

describe("POST /store/donations/checkout — recipient eligibility is forbidden(), 403, one body", () => {
  beforeEach(enable)

  const refusals: Array<[string, Partial<OrgRow> & { key: string; name: string }]> = [
    ["unknown key", gulp({ key: "someone_else" })],
    ["unpublished", gulp({ published: false })],
    ["no connected account", gulp({ stripe_connect_account_id: null })],
    ["unverified 501c3", gulp({ verification_status: "unverified", verified_as_of: null })],
    ["revoked 501c3", gulp({ verification_status: "revoked" })],
    ["not_found 501c3", gulp({ verification_status: "not_found" })],
    ["pending 501c3", gulp({ verification_status: "pending" })],
    ["no org_type, unverified", gulp({ org_type: null, verification_status: "unverified" })],
  ]

  it.each(refusals)("refuses %s with the same 403 and mints nothing", async (_label, row) => {
    const ctx = makeScope({ dir: makeInMemoryDirectory([row]) })
    const res = await call(ctx, { donations: [{ org_key: "ground_up_liberation_project", amount_cents: 2500 }] })
    expect(res.statusCode).toBe(403)
    expect(res.body).toEqual({ message: "You do not have access to this record.", type: "not_allowed" })
    expect(ctx.stripe.paymentIntents.create).not.toHaveBeenCalled()
    expect(ctx.payment.createPaymentCollections).not.toHaveBeenCalled()
    expect(ctx.dons.rows).toEqual([])
  })

  it("one ineligible recipient among several means NO intent for any of them", async () => {
    const ctx = makeScope({ dir: makeInMemoryDirectory([gulp(), coop({ published: false })]) })
    const res = await call(ctx, {
      donations: [
        { org_key: "ground_up_liberation_project", amount_cents: 2500 },
        { org_key: "detroit_food_coop", amount_cents: 1000 },
      ],
    })
    expect(res.statusCode).toBe(403)
    expect(ctx.stripe.paymentIntents.create).not.toHaveBeenCalled()
    expect(ctx.dons.rows).toEqual([])
  })
})

describe("POST /store/donations/checkout — the happy path", () => {
  beforeEach(enable)

  it("N orgs ⇒ N intents, each ON its own connected account, zero BMC fee, recorded with the snapshot, hawala never resolved", async () => {
    const ctx = makeScope()
    const res = await call(
      ctx,
      {
        donations: [
          { org_key: "ground_up_liberation_project", amount_cents: 2500 },
          { org_key: "detroit_food_coop", amount_cents: 1000, campaign_id: "camp_1" },
        ],
      },
      { customerId: "cus_42" }
    )

    expect(res.statusCode).toBe(201)
    const body = res.body as unknown as DonationCheckoutResponse
    expect(body.disclosure).toBe(PROCESSOR_FEE_DISCLOSURE)
    expect(body.donations).toHaveLength(2)

    // Processor: two intents, each with { stripeAccount } for that org and none of the forbidden params.
    expect(ctx.stripe.paymentIntents.create).toHaveBeenCalledTimes(2)
    const calls = ctx.stripe.paymentIntents.create.mock.calls
    expect(calls[0][1]).toMatchObject({ stripeAccount: "acct_1GULP" })
    expect(calls[1][1]).toMatchObject({ stripeAccount: "acct_1COOP" })
    expect(calls[0][0].amount).toBe(2500)
    expect(calls[1][0].amount).toBe(1000)
    for (const [params] of calls) {
      for (const forbidden of FORBIDDEN_DIRECT_CHARGE_PARAMS) expect(params).not.toHaveProperty(forbidden)
      expect(params.metadata).toMatchObject({ fbm_kind: "donation", fbm_customer_id: "cus_42" })
    }
    expect(ctx.stripe.transfers.create).not.toHaveBeenCalled()

    // Payment module: the session was asked of the direct-charge provider with
    // the connected account in the server-only CONTEXT (what the provider
    // reads) as well as in data (a cross-check).
    expect(ctx.payment.createPaymentSession).toHaveBeenCalledTimes(2)
    expect(ctx.payment.createPaymentSession.mock.calls[0][1]).toMatchObject({
      provider_id: STRIPE_CONNECT_DIRECT_PROVIDER_ID,
      currency_code: "usd",
      amount: "25.00",
      data: expect.objectContaining({ connected_account_id: "acct_1GULP" }),
      context: {
        idempotency_key: expect.any(String),
        [DIRECT_CHARGE_CONTEXT_KEY]: { connected_account_id: "acct_1GULP", org_key: "ground_up_liberation_project", kind: "donation" },
      },
    })
    const secondContext = (ctx.payment.createPaymentSession.mock.calls[1][1] as { context: Record<string, unknown> }).context
    expect(secondContext[DIRECT_CHARGE_CONTEXT_KEY]).toEqual({
      connected_account_id: "acct_1COOP",
      org_key: "detroit_food_coop",
      kind: "donation",
    })
    // Nothing per-attempt in the intent params.
    for (const [params] of calls) expect(params.metadata).not.toHaveProperty("session_id")

    // Record: one row per intent, written second, zero fee, snapshot frozen.
    expect(ctx.dons.rows).toHaveLength(2)
    expect(ctx.dons.rows[0]).toMatchObject({
      stripe_payment_intent_id: "pi_1",
      stripe_account_id: "acct_1GULP",
      org_key: "ground_up_liberation_project",
      kind: "donation",
      gross_cents: 2500,
      bmc_fee_cents: 0,
      status: "created",
      customer_id: "cus_42",
      recipient_org_type: "irs_501c3",
      recipient_verification_status: "pub78_eligible",
      recipient_verified_as_of: AS_OF,
    })
    expect(ctx.dons.rows[0].recipient_snapshot_at).toBeInstanceOf(Date)
    expect(ctx.dons.rows[1]).toMatchObject({
      stripe_payment_intent_id: "pi_2",
      stripe_account_id: "acct_1COOP",
      campaign_id: "camp_1",
      recipient_org_type: "coop",
      recipient_verification_status: "unverified",
      recipient_verified_as_of: null,
    })

    // Response: what the storefront needs, and nothing it must not have.
    expect(body.donations[0]).toMatchObject({
      org_key: "ground_up_liberation_project",
      org_name: "Ground Up Liberation Project",
      stripe_payment_intent_id: "pi_1",
      stripe_account_id: "acct_1GULP",
      client_secret: "pi_1_secret",
      gross_cents: 2500,
      bmc_fee_cents: 0,
      recipient_verification_status: "pub78_eligible",
      recipient_verified_as_of: AS_OF.toISOString(),
    })

    // The flow: fee rung consulted, hawala never.
    expect(ctx.resolved).toContain(PAYOUT_BREAKDOWN_MODULE)
    expect(ctx.resolved).not.toContain(HAWALA_LEDGER_MODULE)
    expect(ctx.hawala.processOrderPayment).not.toHaveBeenCalled()
    expect(ctx.hawala.createTransfer).not.toHaveBeenCalled()
    expect(new Set(ctx.resolved)).toEqual(new Set([PARTNER_DIRECTORY_MODULE, PAYOUT_BREAKDOWN_MODULE, Modules.PAYMENT, DONATION_MODULE]))
  })

  it("records a guest donation with customer_id null", async () => {
    const ctx = makeScope()
    const res = await call(ctx, { donations: [{ org_key: "ground_up_liberation_project", amount_cents: 500 }] })
    expect(res.statusCode).toBe(201)
    expect(ctx.dons.rows[0].customer_id).toBeNull()
    expect(ctx.stripe.paymentIntents.create.mock.calls[0][0].metadata.fbm_customer_id).toBe("")
  })

  it("a retry with the same Idempotency-Key reuses the SAME intent at Stripe and the same record; a different amount does not", async () => {
    const ctx = makeScope()
    const headers = { "idempotency-key": "donor-click-1" }
    const body = { donations: [{ org_key: "ground_up_liberation_project", amount_cents: 2500 }] }
    const r1 = await call(ctx, body, { headers, customerId: "cus_42" })
    const r2 = await call(ctx, body, { headers, customerId: "cus_42" })
    expect(r1.statusCode).toBe(201)
    expect(r2.statusCode).toBe(201)
    const [a, b] = ctx.stripe.paymentIntents.create.mock.calls.map((c) => c[1].idempotencyKey)
    expect(a).toEqual(expect.any(String))
    expect(a).toBe(b)
    // Stripe deduplicated: one intent, one client_secret, one record.
    const d1 = (r1.body as unknown as DonationCheckoutResponse).donations[0]
    const d2 = (r2.body as unknown as DonationCheckoutResponse).donations[0]
    expect(d2.stripe_payment_intent_id).toBe(d1.stripe_payment_intent_id)
    expect(d2.client_secret).toBe(d1.client_secret)
    expect(ctx.stripe.seenKeys.size).toBe(1)
    expect(ctx.dons.rows).toHaveLength(1)
    expect(ctx.dons.calls.create).toHaveLength(1)

    const ctx2 = makeScope()
    await call(ctx2, body, { headers, customerId: "cus_42" })
    const r3 = await call(ctx2, { donations: [{ org_key: "ground_up_liberation_project", amount_cents: 2600 }] }, { headers, customerId: "cus_42" })
    // Same header, different amount: the key includes the header, not the
    // payload, so Stripe sees a reused key with different params.
    expect(r3.statusCode).toBe(409)
    expect(r3.body).toMatchObject({ type: "donation_idempotency_conflict" })
    expect(ctx2.dons.rows).toHaveLength(1)
  })

  it("a signed-in donor's derived key (no header) is stable across a fast retry and reuses the intent", async () => {
    const ctx = makeScope()
    const body = { donations: [{ org_key: "ground_up_liberation_project", amount_cents: 2500 }] }
    await call(ctx, body, { customerId: "cus_42" })
    await call(ctx, body, { customerId: "cus_42" })
    const [a, b] = ctx.stripe.paymentIntents.create.mock.calls.map((c) => c[1].idempotencyKey)
    expect(a).toBe(b)
    expect(ctx.stripe.seenKeys.size).toBe(1)
    expect(ctx.dons.rows).toHaveLength(1)

    await call(ctx, { donations: [{ org_key: "ground_up_liberation_project", amount_cents: 2600 }] }, { customerId: "cus_42" })
    expect(ctx.stripe.paymentIntents.create.mock.calls[2][1].idempotencyKey).not.toBe(a)
    expect(ctx.dons.rows).toHaveLength(2)
  })

  it("two GUESTS giving the same amount to the same org never share a key or an intent (no header ⇒ a per-request nonce)", async () => {
    const ctx = makeScope()
    const body = { donations: [{ org_key: "ground_up_liberation_project", amount_cents: 2500 }] }
    const r1 = await call(ctx, body)
    const r2 = await call(ctx, body)
    expect(r1.statusCode).toBe(201)
    expect(r2.statusCode).toBe(201)
    const [a, b] = ctx.stripe.paymentIntents.create.mock.calls.map((c) => c[1].idempotencyKey)
    expect(a).not.toBe(b)
    expect(ctx.stripe.seenKeys.size).toBe(2)
    expect(ctx.dons.rows).toHaveLength(2)
    expect(ctx.dons.rows[0].stripe_payment_intent_id).not.toBe(ctx.dons.rows[1].stripe_payment_intent_id)

    // A guest who sends the header gets retry safety like anyone else.
    const ctx2 = makeScope()
    const headers = { "idempotency-key": "guest-click-1" }
    await call(ctx2, body, { headers })
    await call(ctx2, body, { headers })
    expect(ctx2.stripe.seenKeys.size).toBe(1)
    expect(ctx2.dons.rows).toHaveLength(1)
  })

  it("answers 409 donation_idempotency_conflict when Stripe reports a reused key with different params, and records nothing", async () => {
    const stripe = makeStripe()
    stripe.paymentIntents.create.mockImplementationOnce(async () => {
      throw stripeIdempotencyError()
    })
    const ctx = makeScope({ stripe })
    const res = await call(ctx, { donations: [{ org_key: "ground_up_liberation_project", amount_cents: 2500 }] }, { customerId: "cus_42" })
    expect(res.statusCode).toBe(409)
    expect(res.body).toMatchObject({ type: "donation_idempotency_conflict" })
    expect(ctx.dons.rows).toEqual([])
  })

  it("throws, not falls back, when a module is registered under a near-miss key", async () => {
    const good = makeScope()
    // The directory lives under the wrong key; the real one is unknown, as awilix would report it.
    const scope = {
      resolve: (key: string) => {
        if (key === "partnerDirectoryModuleService") return good.dir.service
        if (key === PARTNER_DIRECTORY_MODULE) throw new Error(`Could not resolve '${key}'`)
        return good.scope.resolve(key)
      },
    }
    await expect(call({ ...good, scope }, { donations: [{ org_key: "ground_up_liberation_project", amount_cents: 2500 }] })).rejects.toThrow(
      /Could not resolve 'partnerDirectory'/
    )
    expect(good.stripe.paymentIntents.create).not.toHaveBeenCalled()
  })
})

describe("POST /store/donations/checkout — the fee rung is asserted, not trusted", () => {
  beforeEach(enable)

  it("refuses with 409 and mints nothing when the chain does not return 0 by transaction_kind", async () => {
    const ctx = makeScope({ payouts: makePayouts({ forceDetail: { percent: 3, source: "platform_default" } }) })
    const res = await call(ctx, { donations: [{ org_key: "ground_up_liberation_project", amount_cents: 2500 }] })
    expect(res.statusCode).toBe(409)
    expect(res.body).toMatchObject({ type: "donation_fee_not_zero" })
    expect(ctx.stripe.paymentIntents.create).not.toHaveBeenCalled()
    expect(ctx.dons.rows).toEqual([])
  })

  it("refuses a 0 that came from a seller override rather than the kind rule", async () => {
    const ctx = makeScope({ payouts: makePayouts({ forceDetail: { percent: 0, source: "seller_override" } }) })
    const res = await call(ctx, { donations: [{ org_key: "ground_up_liberation_project", amount_cents: 2500 }] })
    expect(res.statusCode).toBe(409)
    expect(ctx.stripe.paymentIntents.create).not.toHaveBeenCalled()
  })

  it("the real chain with a non-zero platform default and no seller still yields 0 for a donation", async () => {
    const ctx = makeScope({ payouts: makePayouts({ defaultPercent: 3 }) })
    const res = await call(ctx, { donations: [{ org_key: "ground_up_liberation_project", amount_cents: 2500 }] })
    expect(res.statusCode).toBe(201)
    expect(ctx.dons.rows[0].bmc_fee_cents).toBe(0)
  })
})

describe("POST /store/donations/checkout — the service guard is the last line", () => {
  beforeEach(enable)

  it("a processor that returned a destination-charge shape is refused with 409 and the record is not written", async () => {
    const stripe = makeStripe()
    stripe.paymentIntents.create.mockImplementation(async (params: Record<string, unknown>) => ({
      id: "pi_bad",
      object: "payment_intent",
      status: "requires_payment_method",
      amount: params.amount,
      currency: params.currency,
      client_secret: "s",
      transfer_data: { destination: "acct_1GULP" },
      on_behalf_of: null,
      application_fee_amount: null,
      metadata: params.metadata,
    }))
    const ctx = makeScope({ stripe })
    const res = await call(ctx, { donations: [{ org_key: "ground_up_liberation_project", amount_cents: 2500 }] })
    expect(res.statusCode).toBe(409)
    expect(res.body).toMatchObject({ type: "direct_split_invariant", code: "forbidden_intent_param" })
    expect(ctx.dons.rows).toEqual([])
  })
})
