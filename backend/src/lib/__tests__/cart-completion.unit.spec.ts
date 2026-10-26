import { MedusaError, serializeError, TransactionState } from "@medusajs/framework/utils"
import {
  CART_COMPLETION_INCOMPLETE,
  CART_COMPLETION_INCOMPLETE_MESSAGE,
  CART_COMPLETION_INCOMPLETE_STATUS,
  CartCompletionIncompleteError,
  cartCompletionIncompleteResponse,
  executionId,
  FINISHED_EXECUTION_STATES,
  isCartCompletionIncomplete,
  isExecutionUnfinished,
  judgeCartCompletion,
} from "../cart-completion"

/**
 * SD-53: the one decision every FBM cart completion runs after
 * `completeCartWorkflow`, and the error and HTTP answer it shares. The step
 * that gathers the evidence is tested in
 * `workflows/steps/__tests__/require-completed-cart-order.unit.spec.ts`; the
 * real-database behaviour in `integration-tests/http/cart-completion-refuses.spec.ts`.
 */

const execution = { id: "wf_exec_1", workflow_id: "complete-cart", transaction_id: "complete-cart-as-step-auto-1", state: "done" }
const paid = { id: "order_1", total: 5, payments: 1 }

describe("judgeCartCompletion", () => {
  it("accepts an order handed back, read back, linked to the cart, with a finished execution and a payment", () => {
    expect(
      judgeCartCompletion({ cart_id: "cart_1", order_id: "order_1", order: paid, linked_order_id: "order_1", execution })
    ).toEqual({ ok: true, order_id: "order_1" })
  })

  it("accepts an order that owes nothing and has no payment: Medusa completes a free cart without authorizing anything", () => {
    for (const total of [0, "0", 0.0]) {
      expect(
        judgeCartCompletion({ cart_id: "cart_1", order_id: "order_1", order: { id: "order_1", total, payments: 0 }, linked_order_id: "order_1" })
      ).toEqual({ ok: true, order_id: "order_1" })
    }
  })

  it("decides from the read-back alone when the execution was not found", () => {
    expect(judgeCartCompletion({ cart_id: "cart_1", order_id: "order_1", order: paid, linked_order_id: "order_1", execution: null })).toEqual({
      ok: true,
      order_id: "order_1",
    })
  })

  it("refuses a completion that handed back no order id, before anything else is weighed, naming the order the stall left", () => {
    for (const order_id of [undefined, null, ""]) {
      const verdict = judgeCartCompletion({ cart_id: "cart_1", order_id, order: paid, linked_order_id: "order_9", execution })
      expect(verdict).toMatchObject({ ok: false, reason: "no_order_id" })
      expect((verdict as { detail: string }).detail).toContain("cart_1")
      expect((verdict as { detail: string }).detail).toContain("order_9")
    }
    expect(judgeCartCompletion({ cart_id: "cart_1", order_id: undefined, linked_order_id: null })).toMatchObject({
      ok: false,
      reason: "no_order_id",
      detail: "cart cart_1: the cart's completion returned no order id",
    })
  })

  it("refuses an execution that is not done, whatever the order looks like", () => {
    for (const state of [TransactionState.INVOKING, TransactionState.WAITING_TO_COMPENSATE, TransactionState.COMPENSATING, TransactionState.NOT_STARTED, TransactionState.FAILED, TransactionState.REVERTED]) {
      const verdict = judgeCartCompletion({
        cart_id: "cart_1",
        order_id: "order_1",
        order: paid,
        linked_order_id: "order_1",
        execution: { ...execution, state },
      })
      expect(verdict).toMatchObject({ ok: false, reason: "execution_unfinished" })
      expect((verdict as { detail: string }).detail).toContain("complete-cart:complete-cart-as-step-auto-1")
      expect((verdict as { detail: string }).detail).toContain(state)
    }
  })

  it("refuses an order that cannot be read back, and one whose read failed, with the failure in the detail", () => {
    expect(judgeCartCompletion({ cart_id: "cart_1", order_id: "order_1", order: null, linked_order_id: "order_1" })).toMatchObject({
      ok: false,
      reason: "order_not_found",
    })
    // Not read at all is not read back either.
    expect(judgeCartCompletion({ cart_id: "cart_1", order_id: "order_1" })).toMatchObject({ ok: false, reason: "order_not_found" })
    expect(
      judgeCartCompletion({ cart_id: "cart_1", order_id: "order_1", read_error: "connection terminated unexpectedly" })
    ).toMatchObject({ ok: false, reason: "order_not_found", detail: expect.stringContaining("connection terminated unexpectedly") })
  })

  it("refuses an order the cart's link does not name", () => {
    expect(judgeCartCompletion({ cart_id: "cart_1", order_id: "order_1", order: paid, linked_order_id: "order_2" })).toMatchObject({
      ok: false,
      reason: "order_cart_mismatch",
      detail: "cart cart_1 is linked to order order_2, not to order_1",
    })
    expect(judgeCartCompletion({ cart_id: "cart_1", order_id: "order_1", order: paid, linked_order_id: null })).toMatchObject({
      ok: false,
      reason: "order_cart_mismatch",
    })
  })

  it("refuses an order whose total is unknown rather than read it as owing nothing", () => {
    for (const total of [undefined, null]) {
      expect(
        judgeCartCompletion({ cart_id: "cart_1", order_id: "order_1", order: { id: "order_1", total, payments: 0 }, linked_order_id: "order_1" })
      ).toMatchObject({ ok: false, reason: "order_total_unknown" })
    }
  })

  it("refuses an order that owes money and has no payment: what a stalled completion leaves for a retry to find", () => {
    for (const total of [5, "5", 0.01]) {
      const verdict = judgeCartCompletion({
        cart_id: "cart_1",
        order_id: "order_1",
        order: { id: "order_1", total, payments: 0 },
        linked_order_id: "order_1",
        execution,
      })
      expect(verdict).toMatchObject({ ok: false, reason: "order_unpaid" })
      expect((verdict as { detail: string }).detail).toContain("order_1 owes")
    }
  })

  it("counts any payment, as the settlement steps' paid check does (SD-53 (f) is the shared limit)", () => {
    expect(
      judgeCartCompletion({ cart_id: "cart_1", order_id: "order_1", order: { id: "order_1", total: 5, payments: 2 }, linked_order_id: "order_1" })
    ).toEqual({ ok: true, order_id: "order_1" })
  })
})

describe("CartCompletionIncompleteError", () => {
  const error = new CartCompletionIncompleteError({
    cart_id: "cart_1",
    order_id: null,
    reason: "no_order_id",
    detail: "cart cart_1: the cart's completion returned no order id",
    execution: { ...execution, state: "invoking" },
  })

  it("is a MedusaError of type unexpected_state carrying the stable code, the buyer's message and the ids", () => {
    expect(error).toBeInstanceOf(MedusaError)
    expect(error.type).toBe(MedusaError.Types.UNEXPECTED_STATE)
    expect(error.code).toBe(CART_COMPLETION_INCOMPLETE)
    expect(error.message).toBe(CART_COMPLETION_INCOMPLETE_MESSAGE)
    expect(error.reason).toBe("no_order_id")
    expect(error.cart_id).toBe("cart_1")
    expect(error.order_id).toBeNull()
    expect(error.execution_id).toBe("complete-cart:complete-cart-as-step-auto-1")
    expect(error.detail).toContain("returned no order id")
  })

  it("keeps the ids out of the message the buyer sees", () => {
    expect(error.message).not.toContain("cart_1")
    expect(error.message).not.toContain("complete-cart")
  })

  it("is still recognised once the workflow engine has serialized it to a plain object", () => {
    const serialized = serializeError(error) as unknown
    expect(serialized).not.toBeInstanceOf(CartCompletionIncompleteError)
    expect(isCartCompletionIncomplete(serialized)).toBe(true)
    expect(isCartCompletionIncomplete(error)).toBe(true)
    expect((serialized as { reason: string }).reason).toBe("no_order_id")
  })

  it("is not mistaken for other errors", () => {
    for (const other of [undefined, null, "cart_completion_incomplete", 409, new Error("x"), { code: "invalid_state_error" }, new MedusaError(MedusaError.Types.CONFLICT, "x")]) {
      expect(isCartCompletionIncomplete(other)).toBe(false)
    }
  })
})

describe("cartCompletionIncompleteResponse", () => {
  it("answers 409 with the code, the type, the buyer's message and the reason", () => {
    expect(cartCompletionIncompleteResponse({ code: CART_COMPLETION_INCOMPLETE, reason: "order_unpaid" })).toEqual({
      status: 409,
      body: {
        code: "cart_completion_incomplete",
        type: "cart_completion_incomplete",
        message: CART_COMPLETION_INCOMPLETE_MESSAGE,
        reason: "order_unpaid",
      },
    })
    expect(CART_COMPLETION_INCOMPLETE_STATUS).toBe(409)
  })

  it("leaves out a reason it does not know, and never an id", () => {
    const { body } = cartCompletionIncompleteResponse({ code: CART_COMPLETION_INCOMPLETE, reason: "cart_1 order_1" })
    expect(body).not.toHaveProperty("reason")
    expect(JSON.stringify(body)).not.toContain("cart_1")
    expect(cartCompletionIncompleteResponse({ code: CART_COMPLETION_INCOMPLETE }).body).not.toHaveProperty("reason")
  })

  it("tells the buyer no payment was taken, and what to do", () => {
    expect(CART_COMPLETION_INCOMPLETE_MESSAGE).toMatch(/no payment was taken/)
    expect(CART_COMPLETION_INCOMPLETE_MESSAGE).toMatch(/try again/)
    expect(CART_COMPLETION_INCOMPLETE_MESSAGE).toMatch(/contact support/)
  })
})

describe("execution states", () => {
  it("names an execution as <workflow>:<transaction>", () => {
    expect(executionId(execution)).toBe("complete-cart:complete-cart-as-step-auto-1")
  })

  it("treats done, failed and reverted as finished and everything else as unfinished", () => {
    expect([...FINISHED_EXECUTION_STATES].sort()).toEqual(["done", "failed", "reverted"])
    for (const state of ["done", "failed", "reverted"]) expect(isExecutionUnfinished(state)).toBe(false)
    for (const state of ["not_started", "invoking", "waiting_to_compensate", "compensating", undefined, null, ""]) {
      expect(isExecutionUnfinished(state)).toBe(true)
    }
  })
})
