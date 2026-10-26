// The real createStep only runs inside a workflow composer, so stub the SDK
// to expose the step's invoke handler for direct unit testing (the pattern of
// subscription/__tests__/order-settlement-sales.unit.spec.ts).
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
// core-flows is a large module graph; the step needs one constant of it. The
// real value is asserted against a real database in
// integration-tests/http/cart-completion-refuses.spec.ts.
jest.mock("@medusajs/medusa/core-flows", () => ({ completeCartWorkflowId: "complete-cart" }))
// The step makes its logger when its module loads, which jest hoists above
// these consts; the indirection defers the reference until a line is logged.
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

import { ContainerRegistrationKeys, Modules, serializeError } from "@medusajs/framework/utils"
import { CART_COMPLETION_INCOMPLETE, CART_COMPLETION_INCOMPLETE_MESSAGE, isCartCompletionIncomplete } from "../../../lib/cart-completion"
import {
  nestedCompleteCartTransactionId,
  requireCompletedCartOrderStep,
  requireCompletedCartOrderStepId,
} from "../require-completed-cart-order"

/**
 * SD-53: the shared step every FBM completion runs right after
 * `completeCartWorkflow.runAsStep`. What it reads, what it refuses, what it
 * logs. The decision itself is `lib/cart-completion.ts`, tested on its own.
 */

type Invoke = (input: Record<string, unknown>, ctx: Record<string, unknown>) => Promise<{ output: unknown }>
const invoke = (requireCompletedCartOrderStep as unknown as { invokeFn: Invoke }).invokeFn

const TX = "auto-01TXPARENT"
const NESTED = "complete-cart-as-step-auto-01TXPARENT"

type Row = { id?: string; workflow_id: string; transaction_id: string; state: string; context?: unknown }

/**
 * A container serving a query over one cart and one order, and a workflow
 * engine over the given execution rows. Every resolve and every read is
 * recorded.
 */
function world(opts: {
  order?: { id: string; total?: number | string | null; payments?: number } | null
  link?: string | null
  executions?: Row[]
  engine?: "missing" | "throws"
  orderReadThrows?: boolean
} = {}) {
  const graph = jest.fn(async (q: { entity: string; fields?: string[]; filters?: Record<string, unknown> }) => {
    if (q.entity === "order") {
      if (opts.orderReadThrows) throw new Error("connection terminated unexpectedly")
      const order = opts.order === undefined ? { id: "order_1", total: 5, payments: 1 } : opts.order
      if (!order || order.id !== q.filters?.id) return { data: [] }
      return {
        data: [
          {
            id: order.id,
            total: order.total,
            payment_collections: [{ id: "paycol_1", payments: Array.from({ length: order.payments ?? 0 }, (_, i) => ({ id: `pay_${i}` })) }],
          },
        ],
      }
    }
    if (q.entity === "order_cart") {
      const link = opts.link === undefined ? "order_1" : opts.link
      return { data: link ? [{ cart_id: "cart_1", order_id: link }] : [] }
    }
    throw new Error(`unexpected entity ${q.entity}`)
  })
  const listWorkflowExecutions = jest.fn(async (filters: Record<string, unknown>) => {
    if (opts.engine === "throws") throw new Error("engine unavailable")
    const rows = opts.executions ?? []
    return rows.filter((r) => {
      if (filters.workflow_id !== r.workflow_id) return false
      if (filters.transaction_id !== undefined && filters.transaction_id !== r.transaction_id) return false
      if (Array.isArray(filters.state) && !filters.state.includes(r.state)) return false
      return true
    })
  })
  const resolve = jest.fn((key: string, options?: { allowUnregistered?: boolean }) => {
    if (key === ContainerRegistrationKeys.QUERY) return { graph }
    if (key === Modules.WORKFLOW_ENGINE) {
      if (opts.engine === "missing") {
        if (options?.allowUnregistered) return undefined
        throw new Error("Could not resolve 'workflows'")
      }
      return { listWorkflowExecutions }
    }
    throw new Error(`unexpected resolve ${key}`)
  })
  return { container: { resolve }, resolve, graph, listWorkflowExecutions }
}

const ctx = (container: unknown) => ({ container, transactionId: TX, workflowId: "complete-cart-with-tickets" })
const done = (): Row => ({ id: "wf_exec_done", workflow_id: "complete-cart", transaction_id: NESTED, state: "done" })
const stalled = (): Row => ({ id: "wf_exec_stalled", workflow_id: "complete-cart", transaction_id: NESTED, state: "invoking" })

const refusal = async (promise: Promise<unknown>) => {
  try {
    await promise
  } catch (error) {
    return error as { code: string; message: string; reason: string; cart_id: string; order_id: string | null; execution_id: string | null; detail: string }
  }
  throw new Error("expected a refusal")
}

beforeEach(() => {
  logError.mockClear()
  logWarn.mockClear()
})

describe("the step", () => {
  it("is named for the workflow error list", () => {
    expect(requireCompletedCartOrderStepId).toBe("require-completed-cart-order")
    expect((requireCompletedCartOrderStep as unknown as { stepName: string }).stepName).toBe("require-completed-cart-order")
  })

  it("derives the nested completion's transaction id as workflows-sdk's runAsStep does", () => {
    expect(nestedCompleteCartTransactionId(TX)).toBe(NESTED)
  })
})

describe("a completion that yielded an order", () => {
  it("passes when the execution is done, the order is read back under its id, the cart's link names it and it has a payment", async () => {
    const w = world({ executions: [done()] })
    await expect(invoke({ cart_id: "cart_1", order_id: "order_1" }, ctx(w.container))).resolves.toEqual({ output: { order_id: "order_1" } })
    // The execution under the id runAsStep gave it, then the order and the link.
    expect(w.listWorkflowExecutions.mock.calls[0][0]).toEqual({ workflow_id: "complete-cart", transaction_id: NESTED })
    expect(w.listWorkflowExecutions).toHaveBeenCalledTimes(1)
    expect(w.graph.mock.calls.map((c) => [c[0].entity, c[0].filters])).toEqual([
      ["order", { id: "order_1" }],
      ["order_cart", { cart_id: "cart_1" }],
    ])
    expect(w.graph.mock.calls[0][0].fields).toEqual(["id", "total", "payment_collections.id", "payment_collections.payments.id"])
    expect(logError).not.toHaveBeenCalled()
  })

  it("passes a free order with no payment", async () => {
    const w = world({ executions: [done()], order: { id: "order_1", total: 0, payments: 0 } })
    await expect(invoke({ cart_id: "cart_1", order_id: "order_1" }, ctx(w.container))).resolves.toEqual({ output: { order_id: "order_1" } })
  })

  it("decides from the read-back when the engine has no row for the completion, after looking for an unfinished one by cart", async () => {
    const w = world({ executions: [] })
    await expect(invoke({ cart_id: "cart_1", order_id: "order_1" }, ctx(w.container))).resolves.toEqual({ output: { order_id: "order_1" } })
    expect(w.listWorkflowExecutions.mock.calls.map((c) => c[0])).toEqual([
      { workflow_id: "complete-cart", transaction_id: NESTED },
      { workflow_id: "complete-cart", state: ["not_started", "invoking", "waiting_to_compensate", "compensating"] },
    ])
  })

  it("decides from the read-back when the engine cannot be read, and says so at warn level", async () => {
    const w = world({ engine: "throws" })
    await expect(invoke({ cart_id: "cart_1", order_id: "order_1" }, ctx(w.container))).resolves.toEqual({ output: { order_id: "order_1" } })
    expect(logWarn).toHaveBeenCalledWith(expect.stringContaining("engine unavailable"))
  })

  it("decides from the read-back when no workflow engine is registered", async () => {
    const w = world({ engine: "missing" })
    await expect(invoke({ cart_id: "cart_1", order_id: "order_1" }, ctx(w.container))).resolves.toEqual({ output: { order_id: "order_1" } })
    expect(w.resolve).toHaveBeenCalledWith(Modules.WORKFLOW_ENGINE, { allowUnregistered: true })
  })

  it("refuses when the completion's execution is not done, whatever the order looks like", async () => {
    const w = world({ executions: [stalled()] })
    const error = await refusal(invoke({ cart_id: "cart_1", order_id: "order_1" }, ctx(w.container)))
    expect(error).toMatchObject({ code: CART_COMPLETION_INCOMPLETE, reason: "execution_unfinished", cart_id: "cart_1", order_id: "order_1", execution_id: `complete-cart:${NESTED}` })
  })

  it("refuses an order it cannot read back", async () => {
    const w = world({ executions: [done()], order: null })
    expect(await refusal(invoke({ cart_id: "cart_1", order_id: "order_1" }, ctx(w.container)))).toMatchObject({ reason: "order_not_found" })
  })

  it("refuses when the order read fails, with the failure in the detail, rather than guess", async () => {
    const w = world({ executions: [done()], orderReadThrows: true })
    const error = await refusal(invoke({ cart_id: "cart_1", order_id: "order_1" }, ctx(w.container)))
    expect(error).toMatchObject({ reason: "order_not_found" })
    expect(error.detail).toContain("connection terminated unexpectedly")
  })

  it("refuses an order the cart's link does not name", async () => {
    const w = world({ executions: [done()], link: "order_2" })
    expect(await refusal(invoke({ cart_id: "cart_1", order_id: "order_1" }, ctx(w.container)))).toMatchObject({ reason: "order_cart_mismatch" })
  })

  it("refuses an order with no total, and one that owes money and has no payment", async () => {
    expect(
      await refusal(invoke({ cart_id: "cart_1", order_id: "order_1" }, ctx(world({ executions: [done()], order: { id: "order_1", total: null, payments: 0 } }).container)))
    ).toMatchObject({ reason: "order_total_unknown" })
    expect(
      await refusal(invoke({ cart_id: "cart_1", order_id: "order_1" }, ctx(world({ executions: [done()], order: { id: "order_1", total: 5, payments: 0 } }).container)))
    ).toMatchObject({ reason: "order_unpaid", order_id: "order_1" })
  })
})

describe("a completion that yielded no order", () => {
  it.each([undefined, null, ""])("refuses an order id of %p before the order is read, and names the order the stall left and its execution", async (order_id) => {
    const left: Row = {
      id: "wf_exec_left",
      workflow_id: "complete-cart",
      transaction_id: "complete-cart-as-step-auto-OTHER",
      state: "invoking",
      context: { data: { payload: { id: "cart_1" } } },
    }
    const other: Row = { ...left, id: "wf_exec_other", transaction_id: "complete-cart-as-step-auto-ELSE", context: { data: { payload: { id: "cart_2" } } } }
    const w = world({ executions: [other, left], link: "order_left" })
    const error = await refusal(invoke({ cart_id: "cart_1", order_id }, ctx(w.container)))
    expect(error).toMatchObject({
      code: CART_COMPLETION_INCOMPLETE,
      message: CART_COMPLETION_INCOMPLETE_MESSAGE,
      reason: "no_order_id",
      cart_id: "cart_1",
      order_id: null,
      execution_id: "complete-cart:complete-cart-as-step-auto-OTHER",
    })
    expect(error.detail).toContain("order_left")
    // No order was read; the link was, to say what was left.
    expect(w.graph.mock.calls.map((c) => c[0].entity)).toEqual(["order_cart"])
  })

  it("refuses even when nothing about the stall can be read", async () => {
    const w = world({ engine: "throws", link: null })
    w.graph.mockImplementation(async () => {
      throw new Error("down")
    })
    const error = await refusal(invoke({ cart_id: "cart_1", order_id: undefined }, ctx(w.container)))
    expect(error).toMatchObject({ reason: "no_order_id", execution_id: null })
  })
})

describe("the refusal", () => {
  it("is logged at error level with the cart id and the execution id", async () => {
    const w = world({ executions: [stalled()] })
    await refusal(invoke({ cart_id: "cart_1", order_id: "order_1" }, ctx(w.container)))
    expect(logError).toHaveBeenCalledTimes(1)
    const [message, context] = logError.mock.calls[0]
    expect(message).toContain("refused (execution_unfinished)")
    expect(message).toContain("cart_1")
    expect(message).toContain(`complete-cart:${NESTED}`)
    expect(context).toMatchObject({
      cart_id: "cart_1",
      order_id: "order_1",
      execution_id: `complete-cart:${NESTED}`,
      execution_row_id: "wf_exec_stalled",
      execution_state: "invoking",
      workflow_id: "complete-cart-with-tickets",
      transaction_id: TX,
    })
  })

  it("survives the engine's serialization with its code, so the HTTP layer can answer it", async () => {
    const w = world({ executions: [stalled()] })
    const error = await refusal(invoke({ cart_id: "cart_1", order_id: "order_1" }, ctx(w.container)))
    const serialized = serializeError(error as unknown as Error) as unknown
    expect(isCartCompletionIncomplete(serialized)).toBe(true)
    expect((serialized as { reason: string }).reason).toBe("execution_unfinished")
  })
})
