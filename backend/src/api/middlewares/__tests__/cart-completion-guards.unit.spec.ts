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
jest.mock("../../../workflows/hooks/complete-cart-guards", () => ({ runMainCheckoutGuards: jest.fn() }))

import path from "path"
import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { CART_COMPLETION_INCOMPLETE_MESSAGE } from "../../../lib/cart-completion"
import { runMainCheckoutGuards } from "../../../workflows/hooks/complete-cart-guards"
import {
  CART_ALREADY_COMPLETED_AT_CHECKOUT_MESSAGE,
  CART_COMPLETION_CHECK_FAILED_MESSAGE,
  refuseGuardedCartCompletion,
} from "../cart-completion-guards"

/**
 * SD-54 / SD-72 (a): FBM's cart-completion guards in front of Mercur's
 * `POST /store/carts/:id/complete`, whose `splitAndCompleteCartWorkflow`
 * never runs Medusa's validate hook.
 *
 * The guards are mocked: what they refuse is their own specs' subject, and
 * which of them the main checkout runs is `complete-cart-guards.unit.spec.ts`'s.
 * This spec says what the middleware decides: when it runs them, with what,
 * that a refusal stops the completion, that a cart Medusa's own workflow
 * completed is answered here and never reaches Mercur (409
 * `cart_already_completed` only when `judgeCartCompletion` passes the order it
 * is linked to, else 409 `cart_completion_incomplete`), and that a check it
 * cannot make is answered 409
 * `cart_completion_check_failed`, never passed on.
 * `integration-tests/http/main-checkout-guards.spec.ts` runs the real guards
 * through Mercur's real route.
 */

const guards = jest.mocked(runMainCheckoutGuards)

type Graph = { entity: string; fields: string[]; filters: Record<string, unknown> }
type Cart = { id: string; completed_at?: unknown }
type Order = { id: string; total?: number | string | null; payment_collections?: Array<{ id: string; payments: Array<{ id: string }> }> }

/**
 * A request for `cart_1` whose scope answers only under the query's real
 * registration key: a guessed key throws, so a middleware that resolved one
 * would fail here rather than read nothing.
 */
function request(opts: {
  cart?: Cart | null
  orderSets?: Array<{ id: string; cart_id: string }>
  orderCarts?: Array<{ cart_id: string; order_id: string }>
  orders?: Order[]
  cartThrows?: boolean
  orderSetThrows?: boolean
  orderCartThrows?: boolean
  orderThrows?: boolean
  resolveThrows?: boolean
}) {
  const reads: Graph[] = []
  const graph = jest.fn(async (q: Graph) => {
    reads.push(q)
    if (q.entity === "cart") {
      if (opts.cartThrows) throw new Error("cart read failed: connection terminated")
      return { data: opts.cart && q.filters.id === opts.cart.id ? [opts.cart] : [] }
    }
    if (q.entity === "order_set") {
      if (opts.orderSetThrows) throw new Error("order set read failed: connection terminated")
      return { data: (opts.orderSets ?? []).filter((s) => s.cart_id === q.filters.cart_id) }
    }
    if (q.entity === "order_cart") {
      if (opts.orderCartThrows) throw new Error("order link read failed: connection terminated")
      return { data: (opts.orderCarts ?? []).filter((l) => l.cart_id === q.filters.cart_id) }
    }
    if (q.entity === "order") {
      if (opts.orderThrows) throw new Error("order read failed: connection terminated")
      return { data: (opts.orders ?? []).filter((o) => o.id === q.filters.id) }
    }
    throw new Error(`unexpected entity ${q.entity}`)
  })
  const resolve = jest.fn((key: string) => {
    if (opts.resolveThrows) throw new Error("container disposed")
    if (key === ContainerRegistrationKeys.QUERY) return { graph }
    throw new Error(`unresolvable: ${key}`)
  })
  const scope = { resolve }
  const req = { params: { id: "cart_1" }, scope } as unknown as MedusaRequest
  type Res = { statusCode?: number; body?: unknown; status: jest.Mock; json: jest.Mock }
  const res: Res = {
    status: jest.fn((code: number) => {
      res.statusCode = code
      return res
    }),
    json: jest.fn((body: unknown) => {
      res.body = body
      return res
    }),
  }
  const next = jest.fn() as unknown as jest.Mock & MedusaNextFunction
  const run = () => refuseGuardedCartCompletion(req, res as unknown as MedusaResponse, next)
  return { req, res, next, run, reads, resolve, scope }
}

const CART_READ: Graph = { entity: "cart", fields: ["id", "completed_at"], filters: { id: "cart_1" } }
const ORDER_SET_READ: Graph = { entity: "order_set", fields: ["id"], filters: { cart_id: "cart_1" } }
const ORDER_CART_READ: Graph = { entity: "order_cart", fields: ["cart_id", "order_id"], filters: { cart_id: "cart_1" } }
const ORDER_READ: Graph = {
  entity: "order",
  fields: ["id", "total", "payment_collections.id", "payment_collections.payments.id"],
  filters: { id: "order_1" },
}
const paid = (id: string, total: number | string | null = 10): Order => ({ id, total, payment_collections: [{ id: "paycol_1", payments: [{ id: "pay_1" }] }] })
const unpaid = (id: string, total: number | string | null = 10): Order => ({ id, total, payment_collections: [{ id: "paycol_1", payments: [] }] })

const alreadyCompleted = (orderId?: string) => ({
  code: "cart_already_completed",
  type: "cart_already_completed",
  message: CART_ALREADY_COMPLETED_AT_CHECKOUT_MESSAGE,
  ...(orderId ? { order_id: orderId } : {}),
})
const incomplete = (reason: string) => ({
  code: "cart_completion_incomplete",
  type: "cart_completion_incomplete",
  message: CART_COMPLETION_INCOMPLETE_MESSAGE,
  reason,
})
const checkFailed = {
  code: "cart_completion_check_failed",
  type: "cart_completion_check_failed",
  message: CART_COMPLETION_CHECK_FAILED_MESSAGE,
}

beforeEach(() => {
  guards.mockReset()
  guards.mockResolvedValue(undefined)
  logError.mockClear()
  logWarn.mockClear()
})

describe("refuseGuardedCartCompletion", () => {
  it("runs the main checkout's guards on a cart that has not completed and has no order set, with the hook's argument and the request's scope, then goes on", async () => {
    const t = request({ cart: { id: "cart_1", completed_at: null } })
    await t.run()

    expect(guards).toHaveBeenCalledTimes(1)
    expect(guards.mock.calls[0][0]).toEqual({ input: { id: "cart_1" }, cart: { id: "cart_1", completed_at: null } })
    expect(guards.mock.calls[0][1]).toEqual({ container: t.scope })
    expect((guards.mock.calls[0][1] as { container: unknown }).container).toBe(t.scope)
    expect(t.next).toHaveBeenCalledTimes(1)
    expect(t.next).toHaveBeenCalledWith()
    expect(t.res.status).not.toHaveBeenCalled()
    expect(t.reads).toEqual([CART_READ, ORDER_SET_READ])
    // Only the query, under its real key.
    expect(t.resolve.mock.calls.map((c) => c[0])).toEqual([ContainerRegistrationKeys.QUERY])
  })

  it("goes on only once the guards have answered", async () => {
    let release: () => void = () => {}
    guards.mockImplementation(() => new Promise<void>((r) => (release = r)))
    const t = request({ cart: { id: "cart_1", completed_at: null } })
    const running = t.run()
    await new Promise((r) => setImmediate(r))
    expect(guards).toHaveBeenCalledTimes(1)
    expect(t.next).not.toHaveBeenCalled()
    release()
    await running
    expect(t.next).toHaveBeenCalledTimes(1)
  })

  it.each([
    ["not_allowed", new MedusaError(MedusaError.Types.NOT_ALLOWED, 'The order cycle "Week 1" is closed and is no longer taking orders.')],
    ["invalid_data", new MedusaError(MedusaError.Types.INVALID_DATA, 'Invalid sliding-scale tier "not-a-tier".')],
  ])("a guard's %s refusal is the answer: it is thrown to the framework as it is, and the route is never reached", async (_label, refusal) => {
    guards.mockRejectedValue(refusal)
    const t = request({ cart: { id: "cart_1", completed_at: null } })

    await expect(t.run()).rejects.toBe(refusal)
    expect(t.next).not.toHaveBeenCalled()
    expect(t.res.status).not.toHaveBeenCalled()
  })

  it("through Medusa's own route-middleware wrapper the refusal goes to next(err), the error handler's way in", async () => {
    const httpDir = path.dirname(require.resolve("@medusajs/framework/http"))
    const { wrapHandler } = require(path.join(httpDir, "utils", "wrap-handler")) as {
      wrapHandler: (fn: typeof refuseGuardedCartCompletion) => typeof refuseGuardedCartCompletion
    }
    const refusal = new MedusaError(MedusaError.Types.INVALID_DATA, 'Invalid sliding-scale tier "not-a-tier".')
    guards.mockRejectedValue(refusal)
    const t = request({ cart: { id: "cart_1", completed_at: null } })

    await wrapHandler(refuseGuardedCartCompletion)(t.req, t.res as unknown as MedusaResponse, t.next)
    expect(t.next).toHaveBeenCalledTimes(1)
    expect(t.next).toHaveBeenCalledWith(refusal)
  })

  describe("an order set exists for the cart (Mercur's own re-run test): not checked, the route answers", () => {
    it("a completion the engine left unfinished, completed_at not yet written", async () => {
      const t = request({ cart: { id: "cart_1", completed_at: null }, orderSets: [{ id: "ordset_1", cart_id: "cart_1" }] })
      await t.run()
      expect(guards).not.toHaveBeenCalled()
      expect(t.next).toHaveBeenCalledTimes(1)
      expect(t.next).toHaveBeenCalledWith()
      expect(t.res.status).not.toHaveBeenCalled()
    })

    it("a retry of a placed order", async () => {
      const t = request({
        cart: { id: "cart_1", completed_at: "2026-11-17T12:00:00.000Z" },
        orderSets: [{ id: "ordset_1", cart_id: "cart_1" }],
      })
      await t.run()
      expect(guards).not.toHaveBeenCalled()
      expect(t.next).toHaveBeenCalledWith()
      expect(t.res.status).not.toHaveBeenCalled()
      // Mercur's own cart: its order link is not read.
      expect(t.reads).toEqual([CART_READ, ORDER_SET_READ])
    })
  })

  describe("completed_at set and no order set (Medusa's own workflow completed it): answered 409 here, never passed to Mercur", () => {
    const completed = (completedAt: unknown = "2026-11-17T12:00:00.000Z") => ({ cart: { id: "cart_1", completed_at: completedAt } })

    it.each([
      ["a Date", new Date("2026-11-17T12:00:00Z")],
      ["an ISO string", "2026-11-17T12:00:00.000Z"],
    ])("completed_at as %s, linked to a paid order: 409 cart_already_completed with that order, no guard, no route", async (_label, completedAt) => {
      const t = request({
        ...completed(completedAt),
        orderSets: [{ id: "ordset_9", cart_id: "cart_9" }],
        orderCarts: [
          { cart_id: "cart_1", order_id: "order_1" },
          { cart_id: "cart_9", order_id: "order_9" },
        ],
        orders: [paid("order_1"), paid("order_9")],
      })
      await t.run()
      expect(t.res.status).toHaveBeenCalledWith(409)
      expect(t.res.body).toEqual(alreadyCompleted("order_1"))
      expect(guards).not.toHaveBeenCalled()
      expect(t.next).not.toHaveBeenCalled()
      expect(t.reads).toEqual([CART_READ, ORDER_SET_READ, ORDER_CART_READ, ORDER_READ])
      expect(logWarn).toHaveBeenCalledWith(expect.stringContaining("Mercur not called"), { cart_id: "cart_1", order_id: "order_1" })
    })

    it("linked to an order that owes nothing and has no payment: already placed (Medusa completes it without authorizing)", async () => {
      const t = request({ ...completed(), orderCarts: [{ cart_id: "cart_1", order_id: "order_1" }], orders: [unpaid("order_1", 0)] })
      await t.run()
      expect(t.res.body).toEqual(alreadyCompleted("order_1"))
    })

    it("linked to an order that owes money and has no payment (a stalled or still-running Medusa completion): 409 cart_completion_incomplete, order_unpaid, no order id", async () => {
      const t = request({ ...completed(), orderCarts: [{ cart_id: "cart_1", order_id: "order_1" }], orders: [unpaid("order_1")] })
      await t.run()
      expect(t.res.status).toHaveBeenCalledWith(409)
      expect(t.res.body).toEqual(incomplete("order_unpaid"))
      expect(JSON.stringify(t.res.body)).not.toContain("order_1")
      expect(guards).not.toHaveBeenCalled()
      expect(t.next).not.toHaveBeenCalled()
      expect(logError).toHaveBeenCalledWith(expect.stringContaining("(order_unpaid)"), { cart_id: "cart_1", order_id: "order_1", reason: "order_unpaid" })
    })

    it.each([
      ["linked to no order (no order_cart link)", {}, "no_order_id", [CART_READ, ORDER_SET_READ, ORDER_CART_READ]],
      ["linked to an order that is not there", { orderCarts: [{ cart_id: "cart_1", order_id: "order_1" }] }, "order_not_found", [CART_READ, ORDER_SET_READ, ORDER_CART_READ, ORDER_READ]],
      ["linked to an order whose total is unknown", { orderCarts: [{ cart_id: "cart_1", order_id: "order_1" }], orders: [paid("order_1", null)] }, "order_total_unknown", [CART_READ, ORDER_SET_READ, ORDER_CART_READ, ORDER_READ]],
    ])("%s: the judge refuses, so 409 cart_completion_incomplete with no order id", async (_label, more, reason, reads) => {
      const t = request({ ...completed(), ...more })
      await t.run()
      expect(t.res.status).toHaveBeenCalledWith(409)
      expect(t.res.body).toEqual(incomplete(reason as string))
      expect(t.next).not.toHaveBeenCalled()
      expect(t.reads).toEqual(reads)
    })

    it.each([
      ["its order link", { orderCartThrows: true }],
      ["its order", { orderCarts: [{ cart_id: "cart_1", order_id: "order_1" }], orderThrows: true }],
    ])("%s cannot be read: 409 cart_completion_check_failed, never already placed", async (_label, failure) => {
      const t = request({ ...completed(), ...failure })
      await t.run()
      expect(t.res.status).toHaveBeenCalledWith(409)
      expect(t.res.body).toEqual(checkFailed)
      expect(t.next).not.toHaveBeenCalled()
      expect(logError).toHaveBeenCalledWith(expect.stringContaining("its order link or order could not be read"), { cart_id: "cart_1" })
    })
  })

  it("a cart that does not exist is left to Mercur's route, which answers for it; nothing else is read", async () => {
    const t = request({ cart: null })
    await t.run()
    expect(guards).not.toHaveBeenCalled()
    expect(t.next).toHaveBeenCalledWith()
    expect(t.res.status).not.toHaveBeenCalled()
    expect(t.reads).toEqual([CART_READ])
  })

  describe("fails closed, with an answer the buyer can act on: 409 cart_completion_check_failed", () => {
    it.each([
      ["a cart it cannot read", { cartThrows: true }, "its cart or order sets could not be read"],
      ["order sets it cannot read", { orderSetThrows: true }, "its cart or order sets could not be read"],
      ["a query it cannot resolve", { resolveThrows: true }, "its cart or order sets could not be read"],
    ])("%s: no guard runs, the route is not reached, the failure is logged with the cart", async (_label, failure, logged) => {
      const t = request({ cart: { id: "cart_1", completed_at: null }, ...failure })
      await expect(t.run()).resolves.toBeUndefined()
      expect(t.res.status).toHaveBeenCalledWith(409)
      expect(t.res.body).toEqual(checkFailed)
      expect(guards).not.toHaveBeenCalled()
      expect(t.next).not.toHaveBeenCalled()
      expect(logError).toHaveBeenCalledWith(expect.stringContaining(logged), { cart_id: "cart_1" })
    })

    it.each([
      ["a plain error (a read inside a guard failed)", new Error("column does not exist")],
      ["a MedusaError that is not a refusal", new MedusaError(MedusaError.Types.DB_ERROR, "connection reset")],
      ["a TypeError", new TypeError("Cannot read properties of undefined (reading 'items')")],
    ])("a guard that fails without refusing, %s: the same 409, not a 500, and the route is not reached", async (_label, error) => {
      guards.mockRejectedValue(error)
      const t = request({ cart: { id: "cart_1", completed_at: null } })
      await expect(t.run()).resolves.toBeUndefined()
      expect(t.res.status).toHaveBeenCalledWith(409)
      expect(t.res.body).toEqual(checkFailed)
      expect(t.next).not.toHaveBeenCalled()
      expect(logError).toHaveBeenCalledWith(expect.stringContaining("a guard failed without refusing"), { cart_id: "cart_1" })
    })
  })

  it("its answers carry no ids but the order's: no cart id, no API path", () => {
    for (const message of [CART_ALREADY_COMPLETED_AT_CHECKOUT_MESSAGE, CART_COMPLETION_CHECK_FAILED_MESSAGE]) {
      expect(message).not.toMatch(/cart_|order_|\/store\//)
    }
    expect(CART_COMPLETION_CHECK_FAILED_MESSAGE).toMatch(/not placed/)
    expect(CART_ALREADY_COMPLETED_AT_CHECKOUT_MESSAGE).toMatch(/already been placed/)
  })
})
