// The middleware makes its logger when its module loads, which jest hoists
// above this const; the indirection defers the reference until a line is logged.
const logError = jest.fn()
jest.mock("../../../shared/logger", () => ({
  createLogger: () => ({
    error: (...args: unknown[]) => logError(...args),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  }),
}))

import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { CART_COMPLETION_INCOMPLETE_MESSAGE } from "../../../lib/cart-completion"
import {
  refuseUnfinishedCartCompletion,
  SPLIT_AND_COMPLETE_CART_WORKFLOW_ID,
  unfinishedCompletionOf,
} from "../cart-completion-finished"

/**
 * SD-53 on the main checkout: Mercur's `POST /store/carts/:id/complete`
 * answers with its order set even when Medusa's workflow engine left the
 * completion unfinished. The middleware holds that answer, reads the
 * completion's execution, and refuses an unfinished one with 409.
 */

type Row = { id?: string; workflow_id: string; transaction_id: string; state: string }

function request(cartId: string, rows: Row[] | "throws" | "missing") {
  const listWorkflowExecutions = jest.fn(async (filters: Record<string, unknown>) => {
    if (rows === "throws") throw new Error("engine unavailable")
    return (rows as Row[]).filter((r) => r.workflow_id === filters.workflow_id && r.transaction_id === filters.transaction_id)
  })
  const resolve = jest.fn((key: string, options?: { allowUnregistered?: boolean }) => {
    if (key === Modules.WORKFLOW_ENGINE) {
      if (rows === "missing") {
        if (options?.allowUnregistered) return undefined
        throw new Error("unregistered")
      }
      return { listWorkflowExecutions }
    }
    throw new Error(`unexpected resolve ${key}`)
  })
  const req = { params: { id: cartId }, scope: { resolve } } as unknown as MedusaRequest
  // A response whose json() settles a promise, so a test can wait for the
  // answer the middleware sends after its read.
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
      res.body = body
      settle(body)
      return res
    }),
  }
  const next: MedusaNextFunction = jest.fn()
  const run = () => refuseUnfinishedCartCompletion(req, res as unknown as MedusaResponse, next)
  return { req, res, next, run, sent, listWorkflowExecutions }
}

const orderSet = { order_set: { id: "ordset_1", orders: [{ id: "order_1" }] } }
const unfinished = (state = "invoking"): Row => ({ id: "wf_exec_1", workflow_id: SPLIT_AND_COMPLETE_CART_WORKFLOW_ID, transaction_id: "cart_1", state })

beforeEach(() => logError.mockClear())

describe("unfinishedCompletionOf", () => {
  it("reads the completion under the cart id Mercur's route uses as the transaction id", async () => {
    const { req, listWorkflowExecutions } = request("cart_1", [unfinished()])
    await expect(unfinishedCompletionOf(req.scope, "cart_1")).resolves.toMatchObject({ transaction_id: "cart_1", state: "invoking" })
    expect(listWorkflowExecutions).toHaveBeenCalledWith(
      { workflow_id: "split-and-complete-cart", transaction_id: "cart_1" },
      { select: ["id", "workflow_id", "transaction_id", "state"], order: { created_at: "DESC" }, take: 1 }
    )
  })

  it.each(["not_started", "invoking", "waiting_to_compensate", "compensating"])("reports a %s execution as unfinished", async (state) => {
    const { req } = request("cart_1", [unfinished(state)])
    await expect(unfinishedCompletionOf(req.scope, "cart_1")).resolves.toMatchObject({ state })
  })

  it.each(["done", "failed", "reverted"])("reports nothing for a %s execution, and for none at all", async (state) => {
    await expect(unfinishedCompletionOf(request("cart_1", [unfinished(state)]).req.scope, "cart_1")).resolves.toBeNull()
    await expect(unfinishedCompletionOf(request("cart_1", []).req.scope, "cart_1")).resolves.toBeNull()
  })

  it("reports nothing without a workflow engine or a cart id", async () => {
    await expect(unfinishedCompletionOf(request("cart_1", "missing").req.scope, "cart_1")).resolves.toBeNull()
    const { req, listWorkflowExecutions } = request("", [unfinished()])
    await expect(unfinishedCompletionOf(req.scope, "")).resolves.toBeNull()
    expect(listWorkflowExecutions).not.toHaveBeenCalled()
  })
})

describe("refuseUnfinishedCartCompletion", () => {
  it("lets the handler run, then replaces an order-set answer for an unfinished completion with 409 cart_completion_incomplete, and logs the ids", async () => {
    const { res, next, run, sent } = request("cart_1", [unfinished()])
    run()
    expect(next).toHaveBeenCalledTimes(1)

    res.json(orderSet)
    await sent
    expect(res.statusCode).toBe(409)
    expect(res.body).toEqual({
      code: "cart_completion_incomplete",
      type: "cart_completion_incomplete",
      message: CART_COMPLETION_INCOMPLETE_MESSAGE,
      reason: "execution_unfinished",
    })
    expect(logError).toHaveBeenCalledTimes(1)
    const [message, context] = logError.mock.calls[0]
    expect(message).toContain("cart_1")
    expect(message).toContain("split-and-complete-cart:cart_1")
    expect(context).toMatchObject({ cart_id: "cart_1", execution_id: "split-and-complete-cart:cart_1", execution_state: "invoking", execution_row_id: "wf_exec_1" })
  })

  it("passes an order-set answer through when the completion finished (its row is gone)", async () => {
    const { res, run, sent } = request("cart_1", [])
    run()
    res.json(orderSet)
    await expect(sent).resolves.toEqual(orderSet)
    expect(res.statusCode).toBe(200)
    expect(logError).not.toHaveBeenCalled()
  })

  it("passes an order-set answer through when a finished row is still there", async () => {
    const { res, run, sent } = request("cart_1", [unfinished("done")])
    run()
    res.json(orderSet)
    await expect(sent).resolves.toEqual(orderSet)
    expect(res.statusCode).toBe(200)
  })

  it("leaves any other answer alone without reading anything: errors keep their own", async () => {
    const { res, run, sent, listWorkflowExecutions } = request("cart_1", [unfinished()])
    run()
    res.status(400)
    res.json({ type: "invalid_data", message: "Some products in the cart belong to inactive sellers" })
    await expect(sent).resolves.toEqual({ type: "invalid_data", message: "Some products in the cart belong to inactive sellers" })
    expect(res.statusCode).toBe(400)
    expect(listWorkflowExecutions).not.toHaveBeenCalled()
  })

  it("lets the route's answer stand, and logs, when the execution cannot be read: refusing would claim nothing was taken of a completion that may have finished", async () => {
    const { res, run, sent } = request("cart_1", "throws")
    run()
    res.json(orderSet)
    await expect(sent).resolves.toEqual(orderSet)
    expect(res.statusCode).toBe(200)
    expect(logError).toHaveBeenCalledWith(expect.stringContaining("could not read the completion's execution"))
  })

  it("lets the route's answer stand without a workflow engine", async () => {
    const { res, run, sent } = request("cart_1", "missing")
    run()
    res.json(orderSet)
    await expect(sent).resolves.toEqual(orderSet)
  })
})
