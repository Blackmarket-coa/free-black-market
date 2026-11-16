// The middleware makes its logger when its module loads, which jest hoists
// above these consts; the indirection defers the reference until a line is logged.
const logError = jest.fn()
const logWarn = jest.fn()
jest.mock("../../../shared/logger", () => ({
  createLogger: () => ({
    error: (...args: unknown[]) => logError(...args),
    warn: (...args: unknown[]) => logWarn(...args),
    info: jest.fn(),
    debug: jest.fn(),
  }),
}))
// The workflow itself is Medusa's and runs for real in
// integration-tests/http/cart-payment-refresh.spec.ts. Here it is a recorder:
// what matters is when it is called, for which cart, and what the caller is
// told when it fails.
const refreshCartPaymentCollection = jest.fn()
jest.mock("../../../lib/cart-payment-refresh", () => ({
  refreshCartPaymentCollection: (...args: unknown[]) => refreshCartPaymentCollection(...args),
}))

import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { CART_PAYMENT_AMOUNT_MISMATCH_MESSAGE, CART_PAYMENT_REFRESH_FAILED_MESSAGE } from "../../../lib/cart-payment-amount"
import { cartPaymentMiddlewareRoutes } from "../cart-payment-refresh"

/**
 * SD-115. The middleware in front of Mercur's cart routes, as
 * `src/api/middlewares.ts` registers it: each handler is taken from the
 * exported route list by matcher and method, so a route dropped from that
 * list fails here.
 */

type Handler = (req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction) => Promise<void> | void
function handlerFor(matcher: string, method: string): Handler {
  const route = cartPaymentMiddlewareRoutes.find((r) => r.matcher === matcher && r.method === method)
  if (!route) throw new Error(`no middleware registered for ${method} ${matcher}`)
  expect(route.middlewares).toHaveLength(1)
  return route.middlewares![0] as unknown as Handler
}

type Method = { id: string; cart_id: string }
type World = {
  /** The shipping methods the cart module holds; a handler changes this to write. */
  methods: Method[]
  /** What `query.graph` serves for a cart id. */
  carts: Record<string, unknown>
  listShippingMethods?: "throws"
  graph?: "throws"
}

function request(world: World, init: { cartId?: string; method?: string; body?: unknown; fields?: string[] } = {}) {
  const events: string[] = []
  const listShippingMethods = jest.fn(async (filters: { cart_id?: string[]; id?: string[] }) => {
    if (world.listShippingMethods === "throws") throw new Error("cart module unavailable")
    return world.methods.filter(
      (m) => (!filters.cart_id || filters.cart_id.includes(m.cart_id)) && (!filters.id || filters.id.includes(m.id))
    )
  })
  const graph = jest.fn(async (args: { entity: string; fields: string[]; filters: { id: string } }) => {
    events.push(`read ${args.filters.id}`)
    if (world.graph === "throws") throw new Error("query unavailable")
    const cart = world.carts[args.filters.id]
    return { data: cart ? [cart] : [] }
  })
  const resolve = jest.fn((key: string) => {
    if (key === Modules.CART) return { listShippingMethods }
    if (key === ContainerRegistrationKeys.QUERY) return { graph }
    throw new Error(`unexpected resolve ${key}`)
  })
  const cartId = init.cartId ?? "cart_1"
  const req = {
    method: init.method ?? "POST",
    path: `/store/carts/${cartId}/shipping-methods`,
    params: { id: cartId },
    body: init.body,
    validatedBody: init.body,
    queryConfig: { fields: init.fields ?? ["id", "total", "payment_collection.amount"] },
    scope: { resolve },
  } as unknown as MedusaRequest

  // A response whose json() settles a promise, so a test can wait for the
  // answer the middleware sends after its own work.
  let settle: (body: unknown) => void = () => {}
  const sent = new Promise<unknown>((r) => (settle = r))
  type Res = { statusCode: number; body?: unknown; status: jest.Mock; json: jest.Mock }
  const res: Res = {
    statusCode: 200,
    status: jest.fn((code: number) => {
      res.statusCode = code
      return res
    }),
    json: jest.fn((body: unknown) => {
      events.push(`sent ${res.statusCode}`)
      res.body = body
      settle(body)
      return res
    }),
  }
  const sendJson = res.json
  const next = jest.fn() as jest.Mock & MedusaNextFunction
  return { req, res: res as unknown as MedusaResponse, raw: res, sendJson, next, sent, events, resolve, graph, listShippingMethods }
}

beforeEach(() => {
  logError.mockClear()
  logWarn.mockClear()
  refreshCartPaymentCollection.mockReset()
  refreshCartPaymentCollection.mockResolvedValue(undefined)
})

describe("the routes it sits in front of", () => {
  it("are Mercur's two shipping-method routes, its line-item delete, and the completion", () => {
    expect(cartPaymentMiddlewareRoutes.map((r) => `${r.method} ${r.matcher}`)).toEqual([
      "POST /store/carts/:id/shipping-methods",
      "DELETE /store/carts/:id/shipping-methods",
      "DELETE /store/carts/:id/line-items/:line_id",
      "POST /store/carts/:id/complete",
    ])
  })
})

describe("POST /store/carts/:id/shipping-methods: the payment collection is refreshed after the handler's write", () => {
  const handler = handlerFor("/store/carts/:id/shipping-methods", "POST")
  const stale = { cart: { id: "cart_1", total: 34, payment_collection: { id: "pay_col_1", amount: 29 } } }
  const fresh = { id: "cart_1", total: 34, payment_collection: { id: "pay_col_1", amount: 34, payment_sessions: [] } }

  it("lets the handler run, and does nothing until it answers", async () => {
    const t = request({ methods: [], carts: {} })
    await handler(t.req, t.res, t.next)
    expect(t.next).toHaveBeenCalledTimes(1)
    expect(t.next).toHaveBeenCalledWith()
    expect(refreshCartPaymentCollection).not.toHaveBeenCalled()
    expect(t.sendJson).not.toHaveBeenCalled()
  })

  it("the handler answers 200: the cart is refreshed, then read again, and only then is the answer sent, with the collection as the refresh left it", async () => {
    const t = request({ methods: [{ id: "casm_a", cart_id: "cart_1" }], carts: { cart_1: fresh } }, { fields: ["id", "total", "*payment_collection"] })
    refreshCartPaymentCollection.mockImplementation(async () => {
      t.events.push("refresh")
    })
    await handler(t.req, t.res, t.next)
    t.res.json(stale)
    await t.sent

    expect(refreshCartPaymentCollection).toHaveBeenCalledTimes(1)
    expect(refreshCartPaymentCollection).toHaveBeenCalledWith(t.req.scope, "cart_1")
    expect(t.events).toEqual(["refresh", "read cart_1", "sent 200"])
    // The handler's own field list is the one the cart is read with again.
    expect(t.graph).toHaveBeenCalledWith({ entity: "cart", fields: ["id", "total", "*payment_collection"], filters: { id: "cart_1" } })
    expect(t.raw.body).toEqual({ cart: fresh })
    expect(t.raw.statusCode).toBe(200)
  })

  it("a cart with no payment collection yet (a first pass through checkout) is sent as the handler read it: there was nothing to refresh", async () => {
    const t = request({ methods: [], carts: {} })
    await handler(t.req, t.res, t.next)
    const firstPass = { cart: { id: "cart_1", total: 25, payment_collection: null } }
    t.res.json(firstPass)
    await t.sent

    expect(refreshCartPaymentCollection).toHaveBeenCalledTimes(1)
    expect(t.graph).not.toHaveBeenCalled()
    expect(t.raw.body).toBe(firstPass)
  })

  it("the refresh fails: the caller is not told it worked. 500 cart_payment_refresh_failed, and the handler's body is not sent", async () => {
    const t = request({ methods: [], carts: { cart_1: fresh } })
    refreshCartPaymentCollection.mockRejectedValue(new Error("Failed to acquire lock for key cart_1"))
    await handler(t.req, t.res, t.next)
    t.res.json(stale)
    await t.sent

    expect(t.raw.statusCode).toBe(500)
    expect(t.raw.body).toEqual({
      code: "cart_payment_refresh_failed",
      type: "cart_payment_refresh_failed",
      message: CART_PAYMENT_REFRESH_FAILED_MESSAGE,
    })
    expect(t.sendJson).toHaveBeenCalledTimes(1)
    expect(t.graph).not.toHaveBeenCalled()
    expect(logError).toHaveBeenCalledWith(expect.stringContaining("cart cart_1: its payment collection could not be refreshed"), {
      cart_id: "cart_1",
    })
    expect(logError.mock.calls[0][0]).toContain("Failed to acquire lock")
  })

  it("refreshed, but the cart cannot be read again: the answer stays 200 and leaves the collection out rather than send it stale", async () => {
    const t = request({ methods: [], carts: {}, graph: "throws" })
    await handler(t.req, t.res, t.next)
    t.res.json(stale)
    await t.sent

    expect(refreshCartPaymentCollection).toHaveBeenCalledTimes(1)
    expect(t.raw.statusCode).toBe(200)
    expect(t.raw.body).toEqual({ cart: { id: "cart_1", total: 34 } })
    expect(logError).toHaveBeenCalledWith(expect.stringContaining("could not be read again for the response"))
  })

  it("the handler answers an error after its write went through (SD-117: its own read of the cart failed): the cart is refreshed, and the error is passed on as it was", async () => {
    const world: World = { methods: [{ id: "casm_a", cart_id: "cart_1" }], carts: {} }
    const t = request(world)
    await handler(t.req, t.res, t.next)
    // Medusa's add replaces every method: new ids.
    world.methods = [
      { id: "casm_b2", cart_id: "cart_1" },
      { id: "casm_a2", cart_id: "cart_1" },
    ]
    const error = { type: "unknown_error", message: "An unknown error occurred." }
    t.res.status(500).json(error)
    await t.sent

    expect(refreshCartPaymentCollection).toHaveBeenCalledTimes(1)
    expect(refreshCartPaymentCollection).toHaveBeenCalledWith(t.req.scope, "cart_1")
    expect(t.raw.statusCode).toBe(500)
    expect(t.raw.body).toBe(error)
    expect(t.graph).not.toHaveBeenCalled()
  })

  it("the handler answers an error and wrote nothing (a refused option, a workflow that undid its write): nothing is refreshed", async () => {
    const world: World = { methods: [{ id: "casm_a", cart_id: "cart_1" }], carts: {} }
    const t = request(world)
    await handler(t.req, t.res, t.next)
    const error = { type: "invalid_data", message: "Shipping option so_x is not available" }
    t.res.status(400).json(error)
    await t.sent

    expect(refreshCartPaymentCollection).not.toHaveBeenCalled()
    expect(t.raw.statusCode).toBe(400)
    expect(t.raw.body).toBe(error)
  })

  it("an error after a write, and the refresh fails too: the route's error stands and the failed refresh is logged", async () => {
    const world: World = { methods: [], carts: {} }
    const t = request(world)
    refreshCartPaymentCollection.mockRejectedValue(new Error("stripe unavailable"))
    await handler(t.req, t.res, t.next)
    world.methods = [{ id: "casm_a", cart_id: "cart_1" }]
    const error = { type: "unknown_error", message: "An unknown error occurred." }
    t.res.status(500).json(error)
    await t.sent

    expect(t.raw.statusCode).toBe(500)
    expect(t.raw.body).toBe(error)
    expect(logError).toHaveBeenCalledWith(expect.stringContaining("stripe unavailable"), { cart_id: "cart_1" })
  })

  it("the cart's methods cannot be read beforehand: the request still goes on, and an error answer refreshes without the comparison", async () => {
    const t = request({ methods: [], carts: {}, listShippingMethods: "throws" })
    await handler(t.req, t.res, t.next)
    expect(t.next).toHaveBeenCalledTimes(1)
    expect(logWarn).toHaveBeenCalledWith(expect.stringContaining("could not read the shipping methods before POST"))
    t.res.status(500).json({ type: "unknown_error" })
    await t.sent

    expect(refreshCartPaymentCollection).toHaveBeenCalledWith(t.req.scope, "cart_1")
    expect(t.raw.statusCode).toBe(500)
  })

  it("holds one answer: whatever is sent after it goes straight out", async () => {
    const t = request({ methods: [], carts: {} })
    await handler(t.req, t.res, t.next)
    t.res.json({ cart: { id: "cart_1", payment_collection: null } })
    await t.sent
    t.res.json({ second: true })
    expect(t.sendJson).toHaveBeenCalledTimes(2)
    expect(t.raw.body).toEqual({ second: true })
    expect(refreshCartPaymentCollection).toHaveBeenCalledTimes(1)
  })
})

describe("DELETE /store/carts/:id/shipping-methods: the cart refreshed is the one that held the methods named", () => {
  const handler = handlerFor("/store/carts/:id/shipping-methods", "DELETE")

  it("the storefront's call, the cart's own method: that cart is refreshed and read again", async () => {
    const world: World = {
      methods: [
        { id: "casm_a", cart_id: "cart_1" },
        { id: "casm_b", cart_id: "cart_1" },
      ],
      carts: { cart_1: { id: "cart_1", total: 27, payment_collection: { amount: 27, payment_sessions: [] } } },
    }
    const t = request(world, { method: "DELETE", body: { shipping_method_ids: ["casm_a"] } })
    await handler(t.req, t.res, t.next)
    expect(t.listShippingMethods).toHaveBeenCalledWith({ id: ["casm_a"] }, expect.anything())
    world.methods = [{ id: "casm_b", cart_id: "cart_1" }]
    t.res.json({ cart: { id: "cart_1", total: 27, payment_collection: { amount: 32, payment_sessions: [{ id: "payses_1", amount: 32, status: "pending" }] } } })
    await t.sent

    expect(refreshCartPaymentCollection.mock.calls.map((c) => c[1])).toEqual(["cart_1"])
    expect(t.raw.body).toEqual({ cart: world.carts.cart_1 })
  })

  it("a method of another cart, named through this cart's path: the cart that held it is refreshed, this one is not, and the answer is the handler's", async () => {
    const world: World = { methods: [{ id: "casm_other", cart_id: "cart_2" }], carts: {} }
    const t = request(world, { method: "DELETE", body: { shipping_method_ids: ["casm_other"] } })
    await handler(t.req, t.res, t.next)
    world.methods = []
    const body = { cart: { id: "cart_1", total: 15, payment_collection: { amount: 15 } } }
    t.res.json(body)
    await t.sent

    expect(refreshCartPaymentCollection.mock.calls.map((c) => c[1])).toEqual(["cart_2"])
    expect(t.graph).not.toHaveBeenCalled()
    expect(t.raw.body).toBe(body)
  })

  it("an error answer after the removal went through refreshes the cart that held the method; one that removed nothing refreshes none", async () => {
    const world: World = { methods: [{ id: "casm_a", cart_id: "cart_1" }], carts: {} }
    const wrote = request(world, { method: "DELETE", body: { shipping_method_ids: ["casm_a"] } })
    await handler(wrote.req, wrote.res, wrote.next)
    world.methods = []
    wrote.res.status(500).json({ type: "unknown_error" })
    await wrote.sent
    expect(refreshCartPaymentCollection.mock.calls.map((c) => c[1])).toEqual(["cart_1"])

    refreshCartPaymentCollection.mockClear()
    const kept: World = { methods: [{ id: "casm_a", cart_id: "cart_1" }], carts: {} }
    const failed = request(kept, { method: "DELETE", body: { shipping_method_ids: ["casm_a"] } })
    await handler(failed.req, failed.res, failed.next)
    failed.res.status(500).json({ type: "unknown_error" })
    await failed.sent
    expect(refreshCartPaymentCollection).not.toHaveBeenCalled()
  })

  it("no ids, ids that are not strings, or ids no cart holds: nothing was written, nothing is refreshed", async () => {
    for (const body of [{}, { shipping_method_ids: [] }, { shipping_method_ids: [7, null] }, { shipping_method_ids: ["casm_gone"] }, undefined]) {
      refreshCartPaymentCollection.mockClear()
      const t = request({ methods: [{ id: "casm_a", cart_id: "cart_1" }], carts: {} }, { method: "DELETE", body })
      await handler(t.req, t.res, t.next)
      t.res.json({ cart: { id: "cart_1", payment_collection: { amount: 15 } } })
      await t.sent
      expect(refreshCartPaymentCollection).not.toHaveBeenCalled()
      expect(t.raw.statusCode).toBe(200)
    }
  })
})

describe("DELETE /store/carts/:id/line-items/:line_id: refreshed after Mercur's handler, whatever order its two branches ran in", () => {
  const handler = handlerFor("/store/carts/:id/line-items/:line_id", "DELETE")

  it("refreshes the cart in the path and sends the handler's answer, which carries no cart", async () => {
    const t = request({ methods: [{ id: "casm_a", cart_id: "cart_1" }], carts: {} }, { method: "DELETE" })
    await handler(t.req, t.res, t.next)
    const body = { id: "cali_1", object: "line-item", deleted: true }
    t.res.json(body)
    await t.sent

    expect(refreshCartPaymentCollection.mock.calls.map((c) => c[1])).toEqual(["cart_1"])
    expect(t.graph).not.toHaveBeenCalled()
    expect(t.raw.body).toBe(body)
  })
})

describe("POST /store/carts/:id/complete: a session for another amount is refused before the route runs", () => {
  const handler = handlerFor("/store/carts/:id/complete", "POST")
  const refusal = {
    code: "cart_payment_amount_mismatch",
    type: "cart_payment_amount_mismatch",
    message: CART_PAYMENT_AMOUNT_MISMATCH_MESSAGE,
  }
  const cartWith = (total: unknown, amount: unknown, extra: Record<string, unknown> = {}) => ({
    id: "cart_1",
    completed_at: null,
    currency_code: "usd",
    total,
    payment_collection: { id: "pay_col_1", payment_sessions: [{ id: "payses_1", amount, status: "pending" }] },
    ...extra,
  })

  it("a session for the cart's total: the route runs, nothing is sent and nothing is refreshed", async () => {
    const t = request({ methods: [], carts: { cart_1: cartWith(32, 32) } })
    await handler(t.req, t.res, t.next)

    expect(t.next).toHaveBeenCalledTimes(1)
    expect(t.next).toHaveBeenCalledWith()
    expect(t.sendJson).not.toHaveBeenCalled()
    expect(refreshCartPaymentCollection).not.toHaveBeenCalled()
    expect(t.graph).toHaveBeenCalledWith({
      entity: "cart",
      fields: [
        "id",
        "completed_at",
        "currency_code",
        "total",
        "payment_collection.id",
        "payment_collection.payment_sessions.id",
        "payment_collection.payment_sessions.amount",
        "payment_collection.payment_sessions.status",
      ],
      filters: { id: "cart_1" },
    })
  })

  it("a session smaller than the total: 409 with the buyer's message and no ids, the route does not run, and the cart's payment collection is refreshed so the next session is for the total", async () => {
    const t = request({ methods: [], carts: { cart_1: cartWith(36, 32) } })
    await handler(t.req, t.res, t.next)

    expect(t.next).not.toHaveBeenCalled()
    expect(t.raw.statusCode).toBe(409)
    expect(t.raw.body).toEqual(refusal)
    expect(JSON.stringify(t.raw.body)).not.toContain("cart_1")
    expect(refreshCartPaymentCollection).toHaveBeenCalledTimes(1)
    expect(refreshCartPaymentCollection).toHaveBeenCalledWith(t.req.scope, "cart_1")
    expect(t.events).toEqual(["read cart_1", "sent 409"])
    expect(logError).toHaveBeenCalledWith(expect.stringContaining("is for 3200 and the cart's total is 3600"), {
      cart_id: "cart_1",
      reason: "session_amount_mismatch",
    })
  })

  it("a session larger than the total is refused the same way", async () => {
    const t = request({ methods: [], carts: { cart_1: cartWith(13, 20) } })
    await handler(t.req, t.res, t.next)
    expect(t.next).not.toHaveBeenCalled()
    expect(t.raw.statusCode).toBe(409)
    expect(t.raw.body).toEqual(refusal)
  })

  it("the refresh on the way out fails: the refusal stands, and the failure is logged", async () => {
    const t = request({ methods: [], carts: { cart_1: cartWith(36, 32) } })
    refreshCartPaymentCollection.mockRejectedValue(new Error("stripe unavailable"))
    await handler(t.req, t.res, t.next)

    expect(t.next).not.toHaveBeenCalled()
    expect(t.raw.statusCode).toBe(409)
    expect(t.raw.body).toEqual(refusal)
    expect(logError).toHaveBeenCalledWith(expect.stringContaining("could not be refreshed"), { cart_id: "cart_1" })
  })

  it("closed on doubt: a cart that cannot be read, or amounts that cannot be compared, do not complete", async () => {
    const unreadable = request({ methods: [], carts: {}, graph: "throws" })
    await handler(unreadable.req, unreadable.res, unreadable.next)
    expect(unreadable.next).not.toHaveBeenCalled()
    expect(unreadable.raw.statusCode).toBe(409)
    expect(unreadable.raw.body).toEqual(refusal)
    expect(logError).toHaveBeenCalledWith(expect.stringContaining("could not be read"), { cart_id: "cart_1", reason: "amount_unknown" })

    for (const cart of [cartWith(null, 32), cartWith(32, null), cartWith(32, 32, { currency_code: "zzz" })]) {
      const t = request({ methods: [], carts: { cart_1: cart } })
      await handler(t.req, t.res, t.next)
      expect(t.next).not.toHaveBeenCalled()
      expect(t.raw.statusCode).toBe(409)
      expect(t.raw.body).toEqual(refusal)
    }
  })

  it("left to the route: a cart that does not exist, one that has completed, one with no session to authorize, one that owes nothing", async () => {
    const passes: Array<Record<string, unknown>> = [
      {},
      { cart_1: cartWith(36, 32, { completed_at: "2026-11-16T00:00:00.000Z" }) },
      { cart_1: { ...cartWith(36, 32), payment_collection: { id: "pay_col_1", payment_sessions: [] } } },
      { cart_1: { ...cartWith(36, 32), payment_collection: null } },
      { cart_1: { ...cartWith(36, 32), payment_collection: { payment_sessions: [{ id: "payses_1", amount: 32, status: "authorized" }] } } },
      { cart_1: cartWith(0, 20) },
    ]
    for (const carts of passes) {
      const t = request({ methods: [], carts })
      await handler(t.req, t.res, t.next)
      expect(t.next).toHaveBeenCalledTimes(1)
      expect(t.sendJson).not.toHaveBeenCalled()
      expect(refreshCartPaymentCollection).not.toHaveBeenCalled()
    }
  })

  it("reads the cart through the query and resolves nothing else: no ledger, no cart module (Posture A)", async () => {
    for (const cart of [cartWith(32, 32), cartWith(36, 32)]) {
      const t = request({ methods: [], carts: { cart_1: { ...cart, metadata: { ccr_credits_reserved: 3 } } } })
      await handler(t.req, t.res, t.next)
      expect(t.resolve.mock.calls.map((c) => c[0])).toEqual([ContainerRegistrationKeys.QUERY])
    }
  })
})
