jest.mock("../../../workflows/hooks/complete-cart-guards", () => ({ runMainCheckoutGuards: jest.fn() }))

import path from "path"
import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { runMainCheckoutGuards } from "../../../workflows/hooks/complete-cart-guards"
import { refuseGuardedCartCompletion } from "../cart-completion-guards"

/**
 * SD-54 / SD-72 (a): FBM's cart-completion guards in front of Mercur's
 * `POST /store/carts/:id/complete`, whose `splitAndCompleteCartWorkflow`
 * never runs Medusa's validate hook.
 *
 * The guards are mocked: what they refuse is their own specs' subject, and
 * which of them the main checkout runs is `complete-cart-guards.unit.spec.ts`'s.
 * This spec says what the middleware decides: when it runs them, with what,
 * and that a refusal or a failed read stops the completion.
 * `integration-tests/http/main-checkout-guards.spec.ts` runs the real guards
 * through Mercur's real route.
 */

const guards = jest.mocked(runMainCheckoutGuards)

type Graph = { entity: string; fields: string[]; filters: Record<string, unknown> }
type Cart = { id: string; completed_at?: unknown }

/**
 * A request for `cartId` whose scope answers only under the query's real
 * registration key: a guessed key throws, so a middleware that resolved one
 * would fail here rather than read nothing.
 */
function request(opts: { cart?: Cart | null; orderSets?: Array<{ id: string; cart_id: string }>; cartThrows?: boolean; orderSetThrows?: boolean }) {
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
    throw new Error(`unexpected entity ${q.entity}`)
  })
  const resolve = jest.fn((key: string) => {
    if (key === ContainerRegistrationKeys.QUERY) return { graph }
    throw new Error(`unresolvable: ${key}`)
  })
  const scope = { resolve }
  const req = { params: { id: "cart_1" }, scope } as unknown as MedusaRequest
  const res = {} as MedusaResponse
  const next = jest.fn() as unknown as jest.Mock & MedusaNextFunction
  const run = () => refuseGuardedCartCompletion(req, res, next)
  return { req, res, next, run, reads, resolve, scope }
}

const CART_READ: Graph = { entity: "cart", fields: ["id", "completed_at"], filters: { id: "cart_1" } }
const ORDER_SET_READ: Graph = { entity: "order_set", fields: ["id"], filters: { cart_id: "cart_1" } }

beforeEach(() => {
  guards.mockReset()
  guards.mockResolvedValue(undefined)
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

  it("a guard's refusal is the answer: it is thrown to the framework, and the route is never reached", async () => {
    const refusal = new MedusaError(MedusaError.Types.NOT_ALLOWED, "The order cycle \"Week 1\" is closed and is no longer taking orders.")
    guards.mockRejectedValue(refusal)
    const t = request({ cart: { id: "cart_1", completed_at: null } })

    await expect(t.run()).rejects.toBe(refusal)
    expect(t.next).not.toHaveBeenCalled()
  })

  it("through Medusa's own route-middleware wrapper the refusal goes to next(err), the error handler's way in", async () => {
    const httpDir = path.dirname(require.resolve("@medusajs/framework/http"))
    const { wrapHandler } = require(path.join(httpDir, "utils", "wrap-handler")) as {
      wrapHandler: (fn: typeof refuseGuardedCartCompletion) => typeof refuseGuardedCartCompletion
    }
    const refusal = new MedusaError(MedusaError.Types.INVALID_DATA, 'Invalid sliding-scale tier "not-a-tier".')
    guards.mockRejectedValue(refusal)
    const t = request({ cart: { id: "cart_1", completed_at: null } })

    await wrapHandler(refuseGuardedCartCompletion)(t.req, t.res, t.next)
    expect(t.next).toHaveBeenCalledTimes(1)
    expect(t.next).toHaveBeenCalledWith(refusal)
  })

  describe("the two carts it does not check, each for its own reason", () => {
    it("an order set exists for the cart (Mercur's own re-run test): a completion the engine left unfinished, completed_at not yet written", async () => {
      const t = request({ cart: { id: "cart_1", completed_at: null }, orderSets: [{ id: "ordset_1", cart_id: "cart_1" }] })
      await t.run()
      expect(guards).not.toHaveBeenCalled()
      expect(t.next).toHaveBeenCalledTimes(1)
      expect(t.next).toHaveBeenCalledWith()
    })

    it("an order set exists for the cart (Mercur's own re-run test): a retry of a placed order", async () => {
      const t = request({
        cart: { id: "cart_1", completed_at: "2026-11-17T12:00:00.000Z" },
        orderSets: [{ id: "ordset_1", cart_id: "cart_1" }],
      })
      await t.run()
      expect(guards).not.toHaveBeenCalled()
      expect(t.next).toHaveBeenCalledWith()
    })

    it.each([
      ["a Date", new Date("2026-11-17T12:00:00Z")],
      ["an ISO string", "2026-11-17T12:00:00.000Z"],
    ])(
      "completed_at is set (%s) and no order set exists: Medusa's completeCartWorkflow completed it, its validate hook ran the guards then",
      async (_label, completedAt) => {
        const t = request({ cart: { id: "cart_1", completed_at: completedAt }, orderSets: [{ id: "ordset_9", cart_id: "cart_9" }] })
        await t.run()
        expect(guards).not.toHaveBeenCalled()
        expect(t.next).toHaveBeenCalledWith()
        // The order sets were read: that is what tells this cart from Mercur's own.
        expect(t.reads).toEqual([CART_READ, ORDER_SET_READ])
      }
    )
  })

  it("a cart that does not exist is left to Mercur's route, which answers for it; nothing else is read", async () => {
    const t = request({ cart: null })
    await t.run()
    expect(guards).not.toHaveBeenCalled()
    expect(t.next).toHaveBeenCalledWith()
    expect(t.reads).toEqual([CART_READ])
  })

  describe("fails closed on its own reads", () => {
    it("a cart it cannot read: the error is the answer, no guard runs and the route is not reached", async () => {
      const t = request({ cart: { id: "cart_1", completed_at: null }, cartThrows: true })
      await expect(t.run()).rejects.toThrow("cart read failed")
      expect(guards).not.toHaveBeenCalled()
      expect(t.next).not.toHaveBeenCalled()
    })

    it("order sets it cannot read: the same", async () => {
      const t = request({ cart: { id: "cart_1", completed_at: null }, orderSetThrows: true })
      await expect(t.run()).rejects.toThrow("order set read failed")
      expect(guards).not.toHaveBeenCalled()
      expect(t.next).not.toHaveBeenCalled()
    })
  })
})
