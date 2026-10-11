// The real createStep only runs inside a workflow composer, so stub the SDK
// to expose each step's invoke handler for direct unit testing.
jest.mock("@medusajs/framework/workflows-sdk", () => ({
  createStep: (stepName: unknown, invokeFn: unknown, compensateFn: unknown) =>
    Object.assign(jest.fn(), { stepName, invokeFn, compensateFn }),
  StepResponse: class StepResponse {
    constructor(
      public output: unknown,
      public compensateInput?: unknown
    ) {}
  },
}))

import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { PHASE0_FEATURE_FLAGS } from "../../../shared/feature-flags"
import {
  completedCartOrderStep,
  digitalProductCompletedCartOrderStep,
  digitalProductPaymentToCaptureStep,
  linkDigitalProductOrderSellerStep,
  linkSubscriptionOrderSellerStep,
  resolveDigitalProductSellerStep,
  resolveSubscriptionSellerStep,
  subscriptionPaymentToCaptureStep,
} from "../steps/subscription-order-settlement"

/**
 * F5's seller, link and capture steps — and the replay check that keeps a
 * cart already completed away from them (`completedCartOrderStep`) — serve
 * two checkouts (SD-48): the subscription checkout under
 * FF_CONSUMER_SUBSCRIPTIONS_V1, and the digital-product checkout, through the
 * same functions as its own `*DigitalProduct*` steps (sale fixed to
 * `digital_product`), under FF_DIGITAL_ORDER_SETTLEMENT_V1. Each sale reads
 * only its own flag, and with it off the step returns before it resolves
 * anything from the container — no read, so the workflow behaves exactly as
 * before. The real-database
 * behaviour is in integration-tests/http/digital-order-settlement.spec.ts and
 * subscription-order-settlement.spec.ts.
 */

type Invoke = (input: Record<string, unknown>, ctx: { container: unknown }) => Promise<{ output: unknown }>
type StubbedStep = { stepName: string; invokeFn: Invoke; compensateFn?: unknown }
const stub = (step: unknown) => step as StubbedStep
const invokeOf = (step: unknown) => stub(step).invokeFn

const completedOrder = invokeOf(completedCartOrderStep)
const resolveSeller = invokeOf(resolveSubscriptionSellerStep)
const linkSeller = invokeOf(linkSubscriptionOrderSellerStep)
const toCapture = invokeOf(subscriptionPaymentToCaptureStep)

const digitalCompletedOrder = invokeOf(digitalProductCompletedCartOrderStep)
const digitalResolveSeller = invokeOf(resolveDigitalProductSellerStep)
const digitalLinkSeller = invokeOf(linkDigitalProductOrderSellerStep)
const digitalToCapture = invokeOf(digitalProductPaymentToCaptureStep)

const DIGITAL = PHASE0_FEATURE_FLAGS.DIGITAL_ORDER_SETTLEMENT_V1
const SUBS = PHASE0_FEATURE_FLAGS.CONSUMER_SUBSCRIPTIONS_V1

/**
 * A container that records every resolve and serves a query over a two-seller
 * cart — completed into `completedInto`, when given.
 */
function recordingContainer(completedInto: string | null = null) {
  const graph = jest.fn(async (q: { entity: string }) => {
    if (q.entity === "order_cart") {
      return { data: completedInto ? [{ cart_id: "cart_1", order_id: completedInto }] : [] }
    }
    if (q.entity === "cart") {
      return { data: [{ id: "cart_1", items: [{ product_id: "prod_a" }, { product_id: "prod_b" }] }] }
    }
    if (q.entity === "product") {
      return {
        data: [
          { id: "prod_a", seller: { id: "sel_a" } },
          { id: "prod_b", seller: { id: "sel_b" } },
        ],
      }
    }
    return { data: [] }
  })
  const resolve = jest.fn((key: string) => {
    if (key === ContainerRegistrationKeys.QUERY) return { graph }
    throw new Error(`unexpected resolve ${key}`)
  })
  return { container: { resolve }, resolve, graph }
}

/** Each digital-product step, as the digital-product workflow calls it, with its nothing-to-do answer. */
const digitalCalls: Array<[string, Invoke, Record<string, unknown>, unknown]> = [
  ["completed cart's order", digitalCompletedOrder, { cart_id: "cart_1" }, { order_id: null }],
  ["resolve seller", digitalResolveSeller, { cart_id: "cart_1" }, { seller_id: null }],
  [
    "link seller",
    digitalLinkSeller,
    { order_id: "order_1", mode: "initial", expected_seller_id: null },
    { linked: false, seller_id: null },
  ],
  ["payment to capture", digitalToCapture, { order_id: "order_1", mode: "initial" }, { payment_id: null }],
]

/** The same steps as the subscription workflow calls them (no `sale`). */
const subscriptionCalls: Array<[string, Invoke, Record<string, unknown>, unknown]> = [
  ["completed cart's order", completedOrder, { cart_id: "cart_1" }, { order_id: null }],
  ["resolve seller", resolveSeller, { cart_id: "cart_1" }, { seller_id: null }],
  ["link seller", linkSeller, { order_id: "order_1", mode: "initial", expected_seller_id: null }, { linked: false, seller_id: null }],
  ["payment to capture", toCapture, { order_id: "order_1", mode: "initial" }, { payment_id: null }],
]

describe("the F5 settlement steps, per sale", () => {
  afterEach(() => {
    delete process.env[DIGITAL]
    delete process.env[SUBS]
  })

  describe.each([
    ["both flags off", {}],
    ["only FF_CONSUMER_SUBSCRIPTIONS_V1 on", { [SUBS]: "true" }],
  ])("digital product sale, %s", (_label, env: Record<string, string>) => {
    it.each(digitalCalls)("%s returns before any read", async (_name, invoke, input, nothing) => {
      Object.assign(process.env, env)
      const { container, resolve } = recordingContainer()
      const res = await invoke(input, { container })
      expect(resolve).not.toHaveBeenCalled()
      expect(res.output).toEqual(nothing)
    })
  })

  describe("subscription sale, only FF_DIGITAL_ORDER_SETTLEMENT_V1 on", () => {
    it.each(subscriptionCalls)("%s returns before any read", async (_name, invoke, input, nothing) => {
      process.env[DIGITAL] = "true"
      const { container, resolve } = recordingContainer()
      const res = await invoke(input, { container })
      expect(resolve).not.toHaveBeenCalled()
      expect(res.output).toEqual(nothing)
    })
  })

  it("digital product sale, its flag on: reads the cart and refuses two sellers in its own words", async () => {
    process.env[DIGITAL] = "true"
    const { container, resolve } = recordingContainer()
    await expect(digitalResolveSeller({ cart_id: "cart_1" }, { container })).rejects.toThrow(
      "A digital product order is sold by one seller, and this cart cannot be: its products belong to 2 sellers."
    )
    expect(resolve).toHaveBeenCalledWith(ContainerRegistrationKeys.QUERY)
  })

  it("the digital-product steps are F5's functions under the digital checkout's own names, sharing F5's link compensation", () => {
    expect(
      [
        digitalProductCompletedCartOrderStep,
        resolveDigitalProductSellerStep,
        linkDigitalProductOrderSellerStep,
        digitalProductPaymentToCaptureStep,
      ].map((step) => stub(step).stepName)
    ).toEqual([
      "digital-product-completed-cart-order",
      "resolve-digital-product-seller",
      "link-digital-product-order-seller",
      "digital-product-payment-to-capture",
    ])
    expect(
      [completedCartOrderStep, resolveSubscriptionSellerStep, linkSubscriptionOrderSellerStep, subscriptionPaymentToCaptureStep].map(
        (step) => stub(step).stepName
      )
    ).toEqual([
      "subscription-completed-cart-order",
      "resolve-subscription-seller",
      "link-subscription-order-seller",
      "subscription-payment-to-capture",
    ])
    expect(stub(linkDigitalProductOrderSellerStep).compensateFn).toBeInstanceOf(Function)
    expect(stub(linkDigitalProductOrderSellerStep).compensateFn).toBe(stub(linkSubscriptionOrderSellerStep).compensateFn)
  })

  describe.each([
    ["digital product sale", digitalCompletedOrder, DIGITAL],
    ["subscription sale", completedOrder, SUBS],
  ])("%s, its flag on: a cart already completed is found by its order_cart link", (_label, invoke, flag) => {
    it("returns the order the cart was completed into", async () => {
      process.env[flag] = "true"
      const { container, graph } = recordingContainer("order_done")
      const res = await invoke({ cart_id: "cart_1" }, { container })
      expect(res.output).toEqual({ order_id: "order_done" })
      expect(graph).toHaveBeenCalledTimes(1)
      expect(graph).toHaveBeenCalledWith({
        entity: "order_cart",
        fields: ["cart_id", "order_id"],
        filters: { cart_id: "cart_1" },
      })
    })

    it("returns null for a cart not completed yet", async () => {
      process.env[flag] = "true"
      const { container } = recordingContainer(null)
      const res = await invoke({ cart_id: "cart_1" }, { container })
      expect(res.output).toEqual({ order_id: null })
    })
  })

  it("subscription sale, its flag on: F5's refusal, word for word", async () => {
    process.env[SUBS] = "true"
    const { container } = recordingContainer()
    await expect(resolveSeller({ cart_id: "cart_1" }, { container })).rejects.toThrow(
      "A subscription is sold by one seller, and this cart cannot be: its products belong to 2 sellers."
    )
  })
})
