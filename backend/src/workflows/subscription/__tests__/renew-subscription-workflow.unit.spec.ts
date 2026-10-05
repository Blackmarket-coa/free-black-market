/**
 * Composition of renewSubscriptionWorkflow, live vs not-live.
 *
 * `FBM_SUBSCRIPTION_RENEWAL_LIVE` is read when the module loads, so each case
 * sets it and loads a fresh copy in `jest.isolateModules`. The workflows SDK
 * and core flows are stubbed so the composer runs as plain code and every
 * step invocation lands in one ordered log — which is what proves the charge
 * is taken before the period rolls (`update-subscription-step:record_order`).
 */
const calls: string[] = []
const sessionInputs: unknown[] = []

jest.mock("@medusajs/framework/workflows-sdk", () => ({
  createWorkflow: (name: unknown, composerFn: unknown) => ({ name, composerFn }),
  createStep: jest.fn(),
  StepResponse: class {},
  WorkflowResponse: class WorkflowResponse {
    constructor(public result: unknown) {}
  },
  transform: (data: unknown, fn: (d: unknown) => unknown) => ({ __transform: fn, __data: data }),
}))

jest.mock("@medusajs/medusa/core-flows", () => {
  const graph = (args: { entity: string }) => {
    calls.push(`query:${args.entity}`)
    const result = { data: [{ id: `${args.entity}_1` }], config: () => result }
    return result
  }
  return {
    useQueryGraphStep: graph,
    createCartWorkflow: { runAsStep: () => (calls.push("createCart"), { id: "cart_new" }) },
    createPaymentCollectionForCartWorkflow: {
      runAsStep: () => (calls.push("createPaymentCollection"), {}),
    },
    createPaymentSessionsWorkflow: {
      runAsStep: (args: { input: unknown }) => {
        calls.push("createPaymentSession")
        sessionInputs.push(args.input)
        return { id: "ps_1" }
      },
    },
    authorizePaymentSessionStep: () => calls.push("authorize"),
    completeCartWorkflow: { runAsStep: () => (calls.push("completeCart"), { id: "order_new" }) },
    createRemoteLinkStep: () => calls.push("link"),
    emitEventStep: (args: { eventName: string }) => calls.push(`emit:${args.eventName}`),
  }
})

jest.mock("../steps/update-subscription", () => ({
  updateSubscriptionStep: (args: { action: string }) => {
    calls.push(`update-subscription-step:${args.action}`)
    return { subscription: { id: "sub_1" } }
  },
}))

jest.mock("../steps/grant-subscription-entitlements", () => ({
  grantSubscriptionEntitlementsStep: () => (calls.push("grant"), { granted_count: 1 }),
}))

const chargeInputs: unknown[] = []
jest.mock("../steps/charge-subscription-renewal", () => ({
  chargeSubscriptionRenewalStep: (input: unknown) => {
    calls.push("charge-subscription-renewal")
    chargeInputs.push(input)
    return { payment_intent_id: "pi_1", idempotency_key: "subscription-renewal:sub_1:x" }
  },
}))

type Composer = { composerFn: (input: { subscription_id: string }) => unknown }

function loadWorkflow(live: boolean): Composer {
  const prev = process.env.FBM_SUBSCRIPTION_RENEWAL_LIVE
  if (live) process.env.FBM_SUBSCRIPTION_RENEWAL_LIVE = "1"
  else delete process.env.FBM_SUBSCRIPTION_RENEWAL_LIVE
  let wf: Composer | undefined
  jest.isolateModules(() => {
    wf = require("../workflows/renew-subscription").renewSubscriptionWorkflow as Composer
  })
  if (prev === undefined) delete process.env.FBM_SUBSCRIPTION_RENEWAL_LIVE
  else process.env.FBM_SUBSCRIPTION_RENEWAL_LIVE = prev
  return wf as Composer
}

describe("renewSubscriptionWorkflow composition", () => {
  beforeEach(() => {
    calls.length = 0
    chargeInputs.length = 0
    sessionInputs.length = 0
  })

  afterEach(() => {
    delete process.env.FBM_SUBSCRIPTION_RENEWAL_LIVE
  })

  it("live: charge → system session → authorize → complete → roll, in that order", () => {
    loadWorkflow(true).composerFn({ subscription_id: "sub_1" })

    const order = (name: string) => calls.indexOf(name)
    expect(order("charge-subscription-renewal")).toBeGreaterThan(order("createPaymentCollection"))
    expect(order("charge-subscription-renewal")).toBeLessThan(order("createPaymentSession"))
    expect(order("createPaymentSession")).toBeLessThan(order("authorize"))
    expect(order("authorize")).toBeLessThan(order("completeCart"))
    // The charge is recorded before the period rolls.
    expect(order("charge-subscription-renewal")).toBeLessThan(
      order("update-subscription-step:record_order")
    )
    expect(calls.filter((c) => c === "charge-subscription-renewal")).toHaveLength(1)
  })

  it("live: the charge is the renewal cart's total, and the session goes to the system provider", () => {
    loadWorkflow(true).composerFn({ subscription_id: "sub_1" })

    const chargeInput = chargeInputs[0] as { __transform: (d: unknown) => unknown }
    expect(
      chargeInput.__transform({
        cartsWithPc: [{ total: 24.5, currency_code: "usd", payment_collection: { id: "pc_1" } }],
        input: { subscription_id: "sub_1" },
      })
    ).toEqual({ subscription_id: "sub_1", amount: 24.5, currency_code: "usd" })

    const sessionInput = sessionInputs[0] as { __transform: (d: unknown) => unknown }
    expect(
      sessionInput.__transform({
        cartsWithPc: [{ total: 24.5, currency_code: "usd", payment_collection: { id: "pc_1" } }],
        charge: { payment_intent_id: "pi_1", idempotency_key: "subscription-renewal:sub_1:x" },
        input: { subscription_id: "sub_1" },
      })
    ).toEqual({
      payment_collection_id: "pc_1",
      provider_id: "pp_system_default",
      data: {
        collected_by: "subscription_renewal_payment_intent",
        subscription_id: "sub_1",
        stripe_payment_intent_id: "pi_1",
        renewal_idempotency_key: "subscription-renewal:sub_1:x",
      },
    })
  })

  it("not live: no cart, no charge, no session — the pre-existing free date-advance path", () => {
    loadWorkflow(false).composerFn({ subscription_id: "sub_1" })

    expect(calls).not.toContain("charge-subscription-renewal")
    expect(calls).not.toContain("createCart")
    expect(calls).not.toContain("createPaymentSession")
    expect(calls).toEqual([
      "query:subscription",
      "update-subscription-step:record_order",
      "grant",
      "emit:subscription.renewal_processed",
    ])
  })
})
