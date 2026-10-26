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
  CART_COMPLETION_SETTLE_MS,
  refuseUnfinishedCartCompletionAfter,
  SPLIT_AND_COMPLETE_CART_WORKFLOW_ID,
  unfinishedCompletionOf,
} from "../cart-completion-finished"

/**
 * SD-53 on the main checkout: Mercur's `POST /store/carts/:id/complete` has
 * no answer of its own for a completion Medusa's workflow engine left
 * unfinished (on a real database it answered 500). The middleware holds
 * whatever the route answers, reads the completion's execution, and refuses
 * one still unfinished after the settle window with 409.
 */

type Row = { id?: string; workflow_id: string; transaction_id: string; state: string }
/** The engine's rows for each read, in order; the last repeats. */
type Reads = Row[][] | "throws" | "missing"

const SETTLE = 300

function request(cartId: string, reads: Reads) {
  let n = 0
  const listWorkflowExecutions = jest.fn(async (filters: Record<string, unknown>) => {
    if (reads === "throws") throw new Error("engine unavailable")
    const rows = (reads as Row[][])[Math.min(n++, (reads as Row[][]).length - 1)] ?? []
    return rows.filter((r) => r.workflow_id === filters.workflow_id && r.transaction_id === filters.transaction_id)
  })
  const resolve = jest.fn((key: string, options?: { allowUnregistered?: boolean }) => {
    if (key === Modules.WORKFLOW_ENGINE) {
      if (reads === "missing") {
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
  const run = () => refuseUnfinishedCartCompletionAfter(SETTLE)(req, res as unknown as MedusaResponse, next)
  return { req, res, next, run, sent, listWorkflowExecutions }
}

const orderSet = { order_set: { id: "ordset_1", orders: [{ id: "order_1" }] } }
const row = (state = "invoking"): Row => ({ id: "wf_exec_1", workflow_id: SPLIT_AND_COMPLETE_CART_WORKFLOW_ID, transaction_id: "cart_1", state })
const refused = {
  code: "cart_completion_incomplete",
  type: "cart_completion_incomplete",
  message: CART_COMPLETION_INCOMPLETE_MESSAGE,
  reason: "execution_unfinished",
}

beforeEach(() => logError.mockClear())

describe("unfinishedCompletionOf", () => {
  it("reads the completion under the cart id Mercur's route uses as the transaction id", async () => {
    const { req, listWorkflowExecutions } = request("cart_1", [[row()]])
    await expect(unfinishedCompletionOf(req.scope, "cart_1", 0)).resolves.toMatchObject({ transaction_id: "cart_1", state: "invoking" })
    expect(listWorkflowExecutions).toHaveBeenCalledTimes(1)
    expect(listWorkflowExecutions).toHaveBeenCalledWith(
      { workflow_id: "split-and-complete-cart", transaction_id: "cart_1" },
      { select: ["id", "workflow_id", "transaction_id", "state"], order: { created_at: "DESC" }, take: 1 }
    )
  })

  it.each(["not_started", "invoking", "waiting_to_compensate", "compensating"])("reports a %s execution still there after the window", async (state) => {
    const { req, listWorkflowExecutions } = request("cart_1", [[row(state)]])
    await expect(unfinishedCompletionOf(req.scope, "cart_1", SETTLE)).resolves.toMatchObject({ state })
    // Read again through the window, not once.
    expect(listWorkflowExecutions.mock.calls.length).toBeGreaterThan(1)
  })

  it("reports nothing for a run that ends within the window: a double submit's first request still running", async () => {
    const { req, listWorkflowExecutions } = request("cart_1", [[row()], [row()], []])
    await expect(unfinishedCompletionOf(req.scope, "cart_1", 5_000)).resolves.toBeNull()
    expect(listWorkflowExecutions).toHaveBeenCalledTimes(3)
  })

  it.each(["done", "failed", "reverted"])("reports nothing for a %s execution, and for none at all, at the first read", async (state) => {
    const ended = request("cart_1", [[row(state)]])
    await expect(unfinishedCompletionOf(ended.req.scope, "cart_1", SETTLE)).resolves.toBeNull()
    expect(ended.listWorkflowExecutions).toHaveBeenCalledTimes(1)
    await expect(unfinishedCompletionOf(request("cart_1", [[]]).req.scope, "cart_1", SETTLE)).resolves.toBeNull()
  })

  it("reports nothing without a workflow engine or a cart id", async () => {
    await expect(unfinishedCompletionOf(request("cart_1", "missing").req.scope, "cart_1", SETTLE)).resolves.toBeNull()
    const { req, listWorkflowExecutions } = request("", [[row()]])
    await expect(unfinishedCompletionOf(req.scope, "", SETTLE)).resolves.toBeNull()
    expect(listWorkflowExecutions).not.toHaveBeenCalled()
  })

  it("gives a completion ten seconds by default", () => {
    expect(CART_COMPLETION_SETTLE_MS).toBe(10_000)
  })
})

describe("refuseUnfinishedCartCompletion", () => {
  it.each([
    ["an order-set answer", 200, orderSet],
    ["Mercur's 500 for a stalled run", 500, { code: "unknown_error", type: "unknown_error", message: "An unknown error occurred." }],
  ])("lets the handler run, then replaces %s with 409 cart_completion_incomplete when the completion is still unfinished, and logs the ids", async (_name, status, body) => {
    const { res, next, run, sent } = request("cart_1", [[row()]])
    run()
    expect(next).toHaveBeenCalledTimes(1)

    res.status(status)
    res.json(body)
    await sent
    expect(res.statusCode).toBe(409)
    expect(res.body).toEqual(refused)
    expect(logError).toHaveBeenCalledTimes(1)
    const [message, context] = logError.mock.calls[0]
    expect(message).toContain("cart_1")
    expect(message).toContain(`answered ${status}`)
    expect(message).toContain("split-and-complete-cart:cart_1")
    expect(context).toMatchObject({
      cart_id: "cart_1",
      execution_id: "split-and-complete-cart:cart_1",
      execution_state: "invoking",
      execution_row_id: "wf_exec_1",
      route_status: status,
    })
  })

  it("passes an order-set answer through when the completion ended (its row is gone)", async () => {
    const { res, run, sent, listWorkflowExecutions } = request("cart_1", [[]])
    run()
    res.json(orderSet)
    await expect(sent).resolves.toEqual(orderSet)
    expect(res.statusCode).toBe(200)
    expect(listWorkflowExecutions).toHaveBeenCalledTimes(1)
    expect(logError).not.toHaveBeenCalled()
  })

  it("passes the answer through when the run ends within the window", async () => {
    const { res, run, sent } = request("cart_1", [[row()], []])
    run()
    res.json(orderSet)
    await expect(sent).resolves.toEqual(orderSet)
    expect(res.statusCode).toBe(200)
    expect(logError).not.toHaveBeenCalled()
  })

  it("keeps Mercur's own refusal: its run ended before it answered", async () => {
    const { res, run, sent } = request("cart_1", [[]])
    run()
    res.status(400)
    res.json({ type: "invalid_data", message: "Seller shipping method not found!" })
    await expect(sent).resolves.toEqual({ type: "invalid_data", message: "Seller shipping method not found!" })
    expect(res.statusCode).toBe(400)
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
