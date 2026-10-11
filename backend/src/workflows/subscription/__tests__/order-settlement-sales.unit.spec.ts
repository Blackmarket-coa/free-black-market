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
  subscriptionCheckoutLockStep,
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

describe("the subscription checkout's cart lock (SD-48)", () => {
  const lockKey = invokeOf(subscriptionCheckoutLockStep)

  afterEach(() => {
    delete process.env[DIGITAL]
    delete process.env[SUBS]
  })

  it.each([
    ["both flags off", {}],
    ["only FF_DIGITAL_ORDER_SETTLEMENT_V1 on", { [DIGITAL]: "true" }],
  ])("%s: no key, so acquireLockStep takes no lock, and nothing is read", async (_label, env: Record<string, string>) => {
    Object.assign(process.env, env)
    const { container, resolve } = recordingContainer()
    const res = await lockKey({ cart_id: "cart_1" }, { container })
    expect(res.output).toEqual({ key: [] })
    expect(resolve).not.toHaveBeenCalled()
  })

  it("FF_CONSUMER_SUBSCRIPTIONS_V1 on: the cart id, the key the digital checkout and Medusa's cart workflows lock a cart under", async () => {
    process.env[SUBS] = "true"
    const { container, resolve } = recordingContainer()
    const res = await lockKey({ cart_id: "cart_1" }, { container })
    expect(res.output).toEqual({ key: ["cart_1"] })
    expect(resolve).not.toHaveBeenCalled()
    expect(stub(subscriptionCheckoutLockStep).stepName).toBe("subscription-checkout-lock")
  })
})

describe("which payment a first completion captures (SD-48)", () => {
  afterEach(() => {
    delete process.env[DIGITAL]
    delete process.env[SUBS]
  })

  type Payment = {
    id: string
    provider_id: string
    captured_at?: string | null
    canceled_at?: string | null
    payment_session_id: string | null
  }

  /** An order on one payment collection holding `payments`, whose collection still has `sessions`. */
  function orderPayments(payments: Payment[], sessions: string[]) {
    const graph = jest.fn(async (q: { entity: string; filters?: Record<string, unknown> }) => {
      if (q.entity === "order") {
        return { data: [{ id: "order_1", payment_collections: [{ id: "paycol_1", payments }] }] }
      }
      if (q.entity === "payment_session") return { data: sessions.map((id) => ({ id })) }
      return { data: [] }
    })
    const resolve = jest.fn((key: string) => {
      if (key === ContainerRegistrationKeys.QUERY) return { graph }
      throw new Error(`unexpected resolve ${key}`)
    })
    return { container: { resolve }, graph }
  }

  const leftover: Payment = { id: "pay_old", provider_id: "pp_stripe_stripe", payment_session_id: "payses_old" }
  const current: Payment = { id: "pay_new", provider_id: "pp_stripe_stripe", payment_session_id: "payses_new" }

  describe.each([
    ["digital product sale", digitalToCapture, DIGITAL],
    ["subscription sale", toCapture, SUBS],
  ])("%s, its flag on", (_label, invoke, flag) => {
    it("captures the payment on the cart's current session, not an earlier attempt's whose session is gone", async () => {
      process.env[flag] = "true"
      const { container, graph } = orderPayments([leftover, current], ["payses_new"])
      const res = await invoke({ order_id: "order_1", mode: "initial" }, { container })
      expect(res.output).toEqual({ payment_id: "pay_new" })
      expect(graph).toHaveBeenCalledWith({
        entity: "payment_session",
        fields: ["id"],
        filters: { payment_collection_id: ["paycol_1"] },
      })
    })

    it("a payment on the current session stays the one to capture even if cancelled, so the payment module refuses it", async () => {
      process.env[flag] = "true"
      const { container } = orderPayments([{ ...current, canceled_at: "2026-10-11T00:00:00Z" }], ["payses_new"])
      const res = await invoke({ order_id: "order_1", mode: "initial" }, { container })
      expect(res.output).toEqual({ payment_id: "pay_new" })
    })

    it("nothing to capture when the current session's payment was captured at authorization", async () => {
      process.env[flag] = "true"
      const { container } = orderPayments([leftover, { ...current, captured_at: "2026-10-11T00:00:00Z" }], ["payses_new"])
      const res = await invoke({ order_id: "order_1", mode: "initial" }, { container })
      expect(res.output).toEqual({ payment_id: null })
    })

    it("two uncaptured payments on live sessions are refused, not guessed between", async () => {
      process.env[flag] = "true"
      const { container } = orderPayments([leftover, current], ["payses_old", "payses_new"])
      await expect(invoke({ order_id: "order_1", mode: "initial" }, { container })).rejects.toThrow(
        "order order_1 has 2 uncaptured payments; none captured"
      )
    })
  })
})

describe("a replay: the order a checkout run again on a completed cart found (SD-48)", () => {
  afterEach(() => {
    delete process.env[DIGITAL]
    delete process.env[SUBS]
  })

  /** An order linked to `linkedTo` (or to nothing), whose products belong to `productSellers`. */
  function orderWithSellers(linkedTo: string | null, productSellers: string[]) {
    const products = productSellers.map((seller, i) => ({ id: `prod_${i}`, seller: { id: seller } }))
    const graph = jest.fn(async (q: { entity: string }) => {
      if (q.entity === "order") {
        return {
          data: [
            {
              id: "order_1",
              seller: linkedTo ? { id: linkedTo } : null,
              items: products.map((p) => ({ product_id: p.id })),
            },
          ],
        }
      }
      if (q.entity === "product") return { data: products }
      return { data: [] }
    })
    const link = { create: jest.fn(async () => undefined), dismiss: jest.fn(async () => undefined) }
    const resolve = jest.fn((key: string) => {
      if (key === ContainerRegistrationKeys.QUERY) return { graph }
      if (key === ContainerRegistrationKeys.LINK) return link
      throw new Error(`unexpected resolve ${key}`)
    })
    return { container: { resolve }, graph, link }
  }

  describe.each([
    ["digital product sale", digitalLinkSeller, digitalToCapture, DIGITAL],
    ["subscription sale", linkSeller, toCapture, SUBS],
  ])("%s, its flag on", (_label, link, capture, flag) => {
    it("an order already linked keeps its seller, even with its product sold by another now", async () => {
      process.env[flag] = "true"
      const { container, link: links } = orderWithSellers("sel_a", ["sel_b"])
      const res = await link({ order_id: "order_1", mode: "replay" }, { container })
      expect(res.output).toEqual({ linked: false, seller_id: "sel_a" })
      expect(links.create).not.toHaveBeenCalled()
    })

    it("an order its first completion left unlinked is linked to its products' one seller", async () => {
      process.env[flag] = "true"
      const { container, link: links } = orderWithSellers(null, ["sel_a", "sel_a"])
      const res = await link({ order_id: "order_1", mode: "replay" }, { container })
      expect(res.output).toEqual({ linked: true, seller_id: "sel_a" })
      expect(links.create).toHaveBeenCalledTimes(1)
    })

    it("an unlinked order with no single seller is left unlinked, not refused", async () => {
      process.env[flag] = "true"
      const { container, link: links } = orderWithSellers(null, ["sel_a", "sel_b"])
      const res = await link({ order_id: "order_1", mode: "replay" }, { container })
      expect(res.output).toEqual({ linked: false, seller_id: null })
      expect(links.create).not.toHaveBeenCalled()
    })

    it("an order the link step left unlinked is not captured, and nothing is read", async () => {
      process.env[flag] = "true"
      const { container, graph } = orderWithSellers(null, [])
      const res = await capture({ order_id: "order_1", mode: "replay", linked_seller_id: null }, { container })
      expect(res.output).toEqual({ payment_id: null })
      expect(graph).not.toHaveBeenCalled()
    })
  })

  it.each([
    ["digital product sale", digitalToCapture, DIGITAL],
    ["subscription sale", toCapture, SUBS],
  ])("%s: a linked order's uncaptured payment on the cart's session is captured, as at a first completion", async (_label, capture, flag) => {
    process.env[flag] = "true"
    const graph = jest.fn(async (q: { entity: string }) => {
      if (q.entity === "order") {
        return {
          data: [
            {
              id: "order_1",
              payment_collections: [
                { id: "paycol_1", payments: [{ id: "pay_1", provider_id: "pp_stripe_stripe", payment_session_id: "payses_1" }] },
              ],
            },
          ],
        }
      }
      if (q.entity === "payment_session") return { data: [{ id: "payses_1" }] }
      return { data: [] }
    })
    const container = { resolve: (key: string) => (key === ContainerRegistrationKeys.QUERY ? { graph } : undefined) }
    const res = await capture({ order_id: "order_1", mode: "replay", linked_seller_id: "sel_a" }, { container })
    expect(res.output).toEqual({ payment_id: "pay_1" })
  })
})
