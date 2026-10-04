jest.mock("stripe", () => ({ __esModule: true, default: jest.fn() }))

import Stripe from "stripe"
import { PaymentSessionStatus } from "@medusajs/framework/utils"
import StripeConnectDirectProviderService from "../service"
import {
  isStripeConnectDirectConfigured,
  STRIPE_CONNECT_DIRECT_PROVIDER_ID,
  STRIPE_CONNECT_DIRECT_PROVIDER_IDENTIFIER,
  stripeConnectDirectProviderConfig,
} from "../registration"
import { DIRECT_CHARGE_CONTEXT_KEY, FORBIDDEN_DIRECT_CHARGE_PARAMS } from "../../../shared/stripe-direct-charge"

/**
 * The provider that mints a donation. What has to be true of it
 * (docs/POSTURE_A_COMPLIANCE.md rule 10, L24): every Stripe call carries the
 * connected account as the `stripeAccount` request option; the account for a
 * NEW intent comes only from the server-set session context — a session built
 * the way the stock store payment-session route builds one (account in `data`,
 * no marker in `context`) is refused, so a storefront caller cannot aim a
 * payment at an account of their choosing; the three Connect parameters that
 * route money through the platform are refused wherever they appear; nothing
 * per-attempt enters the intent params (the idempotency key is per record);
 * amounts reach Stripe as integer cents; and the provider exists in the
 * process only when the registration function says so.
 *
 * The Stripe SDK is mocked at the module boundary and the provider is the
 * real class, so a `stripeAccount` option that went missing would fail here.
 */

type FakeStripe = {
  paymentIntents: {
    create: jest.Mock
    retrieve: jest.Mock
    capture: jest.Mock
    cancel: jest.Mock
    update: jest.Mock
  }
  refunds: { create: jest.Mock }
  transfers: { create: jest.Mock }
}

const StripeCtor = Stripe as unknown as jest.Mock

const intent = (over: Record<string, unknown> = {}) => ({
  id: "pi_1",
  object: "payment_intent",
  status: "requires_payment_method",
  amount: 2500,
  currency: "usd",
  client_secret: "pi_1_secret",
  transfer_data: null,
  on_behalf_of: null,
  application_fee_amount: null,
  metadata: {},
  ...over,
})

let stripe: FakeStripe
let provider: StripeConnectDirectProviderService

beforeEach(() => {
  stripe = {
    paymentIntents: {
      create: jest.fn(async (params: Record<string, unknown>) => intent({ amount: params.amount, metadata: params.metadata })),
      retrieve: jest.fn(async () => intent({ status: "succeeded" })),
      capture: jest.fn(async () => intent({ status: "succeeded" })),
      cancel: jest.fn(async () => intent({ status: "canceled" })),
      update: jest.fn(async (_id: string, params: Record<string, unknown>) => intent({ amount: params.amount })),
    },
    refunds: { create: jest.fn(async () => ({ id: "re_1" })) },
    transfers: { create: jest.fn() },
  }
  StripeCtor.mockImplementation(() => stripe)
  provider = new StripeConnectDirectProviderService({}, { apiKey: "sk_test_platform" })
})

const ACCT = "acct_1GULP"
/** `data` as the payment module hands it over: the checkout's bag plus Medusa's fresh `session_id`. */
const data = (over: Record<string, unknown> = {}) => ({
  connected_account_id: ACCT,
  session_id: "payses_1",
  metadata: { fbm_kind: "donation", fbm_org_key: "gulp", fbm_gross_cents: "2500" },
  ...over,
})
/** `context` as only server code can build it: the module's key plus the checkout's marker. */
const ctx = (over: Record<string, unknown> = {}, marker: Record<string, unknown> | null = {}) => ({
  idempotency_key: "donation-checkout:gulp:abc",
  ...(marker === null ? {} : { [DIRECT_CHARGE_CONTEXT_KEY]: { connected_account_id: ACCT, org_key: "gulp", kind: "donation", ...marker } }),
  ...over,
})
/** What the stock `POST /store/payment-collections/:id/payment-sessions` route produces: body in `data`, workflow-built `context`. */
const stockStoreContext = () => ({
  idempotency_key: "payses_1",
  customer: { id: "cus_attacker", email: "a@example.com" },
  account_holder: undefined,
})

describe("identity and registration", () => {
  it("has the identifier the provider_id is derived from", () => {
    expect(StripeConnectDirectProviderService.identifier).toBe(STRIPE_CONNECT_DIRECT_PROVIDER_IDENTIFIER)
    expect(STRIPE_CONNECT_DIRECT_PROVIDER_ID).toBe("pp_stripe_connect_direct_stripe_connect_direct")
  })

  it("constructs the SDK with the platform key and nothing else", () => {
    expect(StripeCtor).toHaveBeenCalledWith("sk_test_platform")
  })

  it("requires apiKey in validateOptions", () => {
    expect(() => StripeConnectDirectProviderService.validateOptions({})).toThrow(/apiKey/)
    expect(() => StripeConnectDirectProviderService.validateOptions({ apiKey: "sk" })).not.toThrow()
  })

  it("is registered only with the flag, the explicit enable AND the platform key — all three", () => {
    const full = { FF_NONPROFIT_PARITY_V1: "true", STRIPE_CONNECT_DIRECT_ENABLED: "true", STRIPE_API_KEY: "sk_test_x" }
    expect(isStripeConnectDirectConfigured(full)).toBe(true)
    expect(stripeConnectDirectProviderConfig(full)).toEqual({
      resolve: "./src/modules/stripe-connect-direct",
      id: "stripe_connect_direct",
      options: { apiKey: "sk_test_x" },
    })

    expect(stripeConnectDirectProviderConfig({})).toBeNull()
    expect(stripeConnectDirectProviderConfig({ ...full, FF_NONPROFIT_PARITY_V1: undefined })).toBeNull()
    expect(stripeConnectDirectProviderConfig({ ...full, FF_NONPROFIT_PARITY_V1: "1" })).toBeNull()
    expect(stripeConnectDirectProviderConfig({ ...full, STRIPE_CONNECT_DIRECT_ENABLED: undefined })).toBeNull()
    expect(stripeConnectDirectProviderConfig({ ...full, STRIPE_CONNECT_DIRECT_ENABLED: "1" })).toBeNull()
    expect(stripeConnectDirectProviderConfig({ ...full, STRIPE_API_KEY: "" })).toBeNull()
  })
})

describe("initiatePayment — a direct charge ON the connected account", () => {
  it("creates the intent with { stripeAccount } and the idempotency key, in integer cents", async () => {
    const out = await provider.initiatePayment({
      amount: "25.00",
      currency_code: "usd",
      data: data(),
      context: ctx() as never,
    })

    expect(stripe.paymentIntents.create).toHaveBeenCalledTimes(1)
    const [params, options] = stripe.paymentIntents.create.mock.calls[0]
    expect(options).toEqual({ idempotencyKey: "donation-checkout:gulp:abc", stripeAccount: ACCT })
    expect(params.amount).toBe(2500)
    expect(Number.isInteger(params.amount)).toBe(true)
    expect(params.currency).toBe("usd")
    expect(params.metadata).toMatchObject({
      fbm_kind: "donation",
      fbm_org_key: "gulp",
      fbm_gross_cents: "2500",
      fbm_connected_account_id: ACCT,
    })
    for (const forbidden of FORBIDDEN_DIRECT_CHARGE_PARAMS) {
      expect(params).not.toHaveProperty(forbidden)
    }

    expect(out.id).toBe("pi_1")
    expect(out.status).toBe(PaymentSessionStatus.PENDING)
    expect(out.data).toMatchObject({ id: "pi_1", connected_account_id: ACCT })
  })

  it("writes nothing per-attempt into the intent: Medusa's session_id stays out of the metadata", async () => {
    // The idempotency key is per RECORD; Stripe rejects a reused key whose
    // params differ, so a per-attempt value here would break every retry.
    await provider.initiatePayment({ amount: "25.00", currency_code: "usd", data: data({ session_id: "payses_1" }), context: ctx() as never })
    await provider.initiatePayment({ amount: "25.00", currency_code: "usd", data: data({ session_id: "payses_2" }), context: ctx() as never })
    const [a, b] = stripe.paymentIntents.create.mock.calls.map((c) => c[0])
    expect(a.metadata).not.toHaveProperty("session_id")
    expect(a).toEqual(b)
  })

  it("stamps the server-set org, kind and account over whatever the data bag claimed", async () => {
    await provider.initiatePayment({
      amount: 1,
      currency_code: "usd",
      data: data({ metadata: { fbm_kind: "donation", fbm_org_key: "someone_else", fbm_connected_account_id: "acct_OTHER" } }),
      context: ctx() as never,
    })
    expect(stripe.paymentIntents.create.mock.calls[0][0].metadata).toMatchObject({
      fbm_kind: "donation",
      fbm_org_key: "gulp",
      fbm_connected_account_id: ACCT,
    })
  })

  it("rounds a float major amount to the cent exactly once", async () => {
    await provider.initiatePayment({ amount: 12.34, currency_code: "usd", data: data(), context: ctx() as never })
    expect(stripe.paymentIntents.create.mock.calls[0][0].amount).toBe(1234)
    await provider.initiatePayment({ amount: 1000, currency_code: "jpy", data: data(), context: ctx() as never })
    expect(stripe.paymentIntents.create.mock.calls[1][0].amount).toBe(1000)
  })

  it("REFUSES a session shaped like the stock store route's — account in data, no server marker — so a buyer cannot aim a payment at their own account", async () => {
    // What `POST /store/payment-collections/:id/payment-sessions` sends for
    // `{ provider_id, data: { connected_account_id: <mine>, metadata: {...} } }`.
    await expect(
      provider.initiatePayment({
        amount: "250.00",
        currency_code: "usd",
        data: { connected_account_id: "acct_ATTACKER", metadata: { fbm_kind: "donation", fbm_org_key: "ground_up_liberation_project", fbm_connected_account_id: "acct_ATTACKER" }, session_id: "payses_1" },
        context: stockStoreContext() as never,
      })
    ).rejects.toThrow(new RegExp(DIRECT_CHARGE_CONTEXT_KEY))
    // No context at all, as a direct module call without one would be.
    await expect(provider.initiatePayment({ amount: 1, currency_code: "usd", data: data() })).rejects.toThrow(new RegExp(DIRECT_CHARGE_CONTEXT_KEY))
    expect(stripe.paymentIntents.create).not.toHaveBeenCalled()
  })

  it("REFUSES a marker that is not an acct_ id, not a donation kind, or has no org — and never a platform charge", async () => {
    for (const bad of [
      ctx({}, { connected_account_id: "cus_1" }),
      ctx({}, { connected_account_id: "" }),
      ctx({}, { connected_account_id: undefined }),
      ctx({}, { kind: "sale" }),
      ctx({}, { kind: "tip" }),
      ctx({}, { org_key: "" }),
    ]) {
      await expect(provider.initiatePayment({ amount: 1, currency_code: "usd", data: data({ connected_account_id: undefined }), context: bad as never })).rejects.toThrow(
        new RegExp(DIRECT_CHARGE_CONTEXT_KEY)
      )
    }
    expect(stripe.paymentIntents.create).not.toHaveBeenCalled()
  })

  it("REFUSES session data that names a different account than the server-set context", async () => {
    await expect(
      provider.initiatePayment({ amount: 1, currency_code: "usd", data: data({ connected_account_id: "acct_ATTACKER" }), context: ctx() as never })
    ).rejects.toThrow(/different connected account/)
    expect(stripe.paymentIntents.create).not.toHaveBeenCalled()
    // Absent in data is fine: the context is the source.
    await provider.initiatePayment({ amount: 1, currency_code: "usd", data: data({ connected_account_id: undefined }), context: ctx() as never })
    expect(stripe.paymentIntents.create.mock.calls[0][1]).toMatchObject({ stripeAccount: ACCT })
  })

  it("REFUSES each forbidden Connect parameter, at the top level and nested in the input", async () => {
    for (const param of FORBIDDEN_DIRECT_CHARGE_PARAMS) {
      await expect(
        provider.initiatePayment({ amount: 1, currency_code: "usd", data: data({ [param]: param === "application_fee_amount" ? 50 : "acct_PLATFORM" }), context: ctx() as never })
      ).rejects.toThrow(new RegExp(param))
      await expect(
        provider.initiatePayment({ amount: 1, currency_code: "usd", data: data({ metadata: { extra: { [param]: "x" } } }), context: ctx() as never })
      ).rejects.toThrow(new RegExp(param))
    }
    expect(stripe.paymentIntents.create).not.toHaveBeenCalled()
  })

  it("has no code path that calls transfers.create", async () => {
    await provider.initiatePayment({ amount: 5, currency_code: "usd", data: data(), context: ctx() as never })
    const withIntent = { ...data(), ...intent() }
    await provider.capturePayment({ data: withIntent })
    await provider.refundPayment({ amount: 5, data: withIntent })
    await provider.cancelPayment({ data: withIntent })
    expect(stripe.transfers.create).not.toHaveBeenCalled()
  })
})

describe("every later call stays on the connected account", () => {
  const withIntent = () => ({ ...data(), ...intent(), currency: "usd" })

  it("getPaymentStatus / authorizePayment retrieve with { stripeAccount }", async () => {
    const status = await provider.getPaymentStatus({ data: withIntent() })
    expect(stripe.paymentIntents.retrieve).toHaveBeenCalledWith("pi_1", {}, { stripeAccount: ACCT })
    expect(status.status).toBe(PaymentSessionStatus.CAPTURED)
    await provider.authorizePayment({ data: withIntent() })
    expect(stripe.paymentIntents.retrieve).toHaveBeenCalledTimes(2)
  })

  it("capturePayment captures with { stripeAccount, idempotencyKey }", async () => {
    await provider.capturePayment({ data: withIntent(), context: { idempotency_key: "cap_1" } })
    expect(stripe.paymentIntents.capture).toHaveBeenCalledWith("pi_1", {}, { idempotencyKey: "cap_1", stripeAccount: ACCT })
  })

  it("cancelPayment / deletePayment cancel with { stripeAccount }", async () => {
    await provider.cancelPayment({ data: withIntent(), context: { idempotency_key: "can_1" } })
    await provider.deletePayment({ data: withIntent() })
    for (const call of stripe.paymentIntents.cancel.mock.calls) {
      expect(call[2]).toMatchObject({ stripeAccount: ACCT })
    }
    expect(stripe.paymentIntents.cancel).toHaveBeenCalledTimes(2)
  })

  it("refundPayment issues the refund ON the connected account, in integer cents", async () => {
    await provider.refundPayment({ amount: "10.00", data: withIntent(), context: { idempotency_key: "ref_1" } })
    expect(stripe.refunds.create).toHaveBeenCalledWith(
      { payment_intent: "pi_1", amount: 1000 },
      { idempotencyKey: "ref_1", stripeAccount: ACCT }
    )
  })

  it("updatePayment updates with { stripeAccount } and refuses forbidden params", async () => {
    await provider.updatePayment({ amount: "30.00", currency_code: "usd", data: withIntent(), context: { idempotency_key: "upd_1" } })
    expect(stripe.paymentIntents.update).toHaveBeenCalledWith("pi_1", { amount: 3000 }, { idempotencyKey: "upd_1", stripeAccount: ACCT })
    await expect(
      provider.updatePayment({ amount: 1, currency_code: "usd", data: { ...withIntent(), on_behalf_of: "acct_X" } })
    ).rejects.toThrow(/on_behalf_of/)
  })

  it("reads the account back off intent metadata when session data lost connected_account_id", async () => {
    const d = { ...intent(), metadata: { fbm_connected_account_id: ACCT } } as Record<string, unknown>
    await provider.getPaymentStatus({ data: d })
    expect(stripe.paymentIntents.retrieve).toHaveBeenCalledWith("pi_1", {}, { stripeAccount: ACCT })
  })

  it("reports provider webhooks as not supported: connected-account events have their own route", async () => {
    const result = await provider.getWebhookActionAndData({ data: {}, rawData: "", headers: {} })
    expect(result).toEqual({ action: "not_supported" })
  })
})
