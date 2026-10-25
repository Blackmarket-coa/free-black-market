import { MathBN, MedusaError, TransactionState } from "@medusajs/framework/utils"

/**
 * A cart completion that yielded no order is refused, on every FBM path that
 * completes a cart and whatever the feature flags say (SD-53).
 *
 * Medusa 2.14.2's workflow engine can leave `completeCartWorkflow` unfinished
 * after it has written the order, the cart's `order_cart` link and the cart's
 * `completed_at`, and before it authorizes the payment: a race guard in the
 * engine's checkpoint storage (`SkipStepAlreadyFinishedError`) fires inside
 * the `parallelize` block that follows `createOrdersStep`, and the
 * orchestrator treats that error as expected, so the run stops with no error
 * and no compensation. The caller is handed no order id, the card is never
 * authorized, and the `workflow_execution` row stays unfinished. A query
 * filtered on an undefined id is not filtered at all, so a caller that reads
 * on with that id reads some order; and a retry, which `completeCartWorkflow`
 * answers with the cart's existing order while authorizing nothing, would
 * deliver that order unpaid. Both were seen on a real database.
 *
 * This module is the one answer. `judgeCartCompletion` decides, from what a
 * caller read back, whether a completion yielded an order that may be acted
 * on; `CartCompletionIncompleteError` is what every path throws when it did
 * not, with a stable `code` that the HTTP layer answers with 409
 * (`shared/error-sanitizer.ts`) and the hosted checkout pages render
 * themselves. The step that gathers the evidence and throws is
 * `workflows/steps/require-completed-cart-order.ts`, called right after
 * `completeCartWorkflow.runAsStep` in every FBM workflow that completes a cart;
 * the middleware that refuses the same state on Mercur's
 * `POST /store/carts/:id/complete` is `api/middlewares/cart-completion-finished.ts`.
 *
 * What the buyer is told holds on every path. Nothing is captured, delivered,
 * provisioned or settled for a completion that never finished: a workflow's
 * events (`order.placed`, Mercur's `order_set.placed`) are grouped under the
 * run's event group and released only when the run finishes, so no subscriber
 * runs for a stalled one. FBM's own completions stop before
 * `authorizePaymentSessionStep`, so no hold exists; Mercur's split authorizes
 * before it creates its orders, so a hold may exist, and it lapses. Nothing
 * here touches the hawala ledger: Coalition Credits have no completion path
 * (`workflows/hooks/validate-ccr-reservation.ts` refuses a cart holding a
 * reservation before any order exists), so a refused completion cannot move
 * them.
 */

/** The `code` every refusal carries. Stable: clients and tests key on it. */
export const CART_COMPLETION_INCOMPLETE = "cart_completion_incomplete"

/**
 * 409: the cart's completion is in a state this request cannot act on. Medusa's
 * own `POST /store/carts/:id/complete` answers an unfinished completion with
 * 409 as well ("Cart is already being completed by another request").
 */
export const CART_COMPLETION_INCOMPLETE_STATUS = 409

/** What the buyer is told. See the module comment for why each sentence holds. */
export const CART_COMPLETION_INCOMPLETE_MESSAGE =
  "Your order could not be completed, and no payment was taken. " +
  "If your card shows a pending authorization, it will be released. " +
  "Please try again, or contact support if it happens again."

export type CartCompletionRefusalReason =
  /** The completion handed back no order id. */
  | "no_order_id"
  /** The completion's own workflow execution is not `done`. */
  | "execution_unfinished"
  /** The order cannot be read back by the id the completion handed back. */
  | "order_not_found"
  /** The cart's `order_cart` link names another order, or none. */
  | "order_cart_mismatch"
  /** The order came back with no total, so whether it owes money is unknown. */
  | "order_total_unknown"
  /** The order owes money and has no payment at all. */
  | "order_unpaid"

/** A `workflow_execution` row, as far as a refusal needs it. */
export type CompletionExecution = {
  /** The engine's row id, when it was read. */
  id?: string | null
  workflow_id: string
  transaction_id: string
  state: string
}

/** `<workflow id>:<transaction id>`, how an execution is named in logs and errors. */
export const executionId = (execution: CompletionExecution): string =>
  `${execution.workflow_id}:${execution.transaction_id}`

/** The states a workflow execution ends in. Anything else is still running, or never started. */
export const FINISHED_EXECUTION_STATES: ReadonlySet<string> = new Set<string>([
  TransactionState.DONE,
  TransactionState.FAILED,
  TransactionState.REVERTED,
])

export const isExecutionUnfinished = (state: string | null | undefined): boolean =>
  !FINISHED_EXECUTION_STATES.has(state ?? "")

/** What a path read back after a completion, for `judgeCartCompletion`. */
export type CartCompletionEvidence = {
  cart_id: string
  /** The order id the completion handed back, if any. */
  order_id: string | null | undefined
  /**
   * The order read back by that id: `null` when there is none. Required when
   * `order_id` is set; an order that was not read is not one to act on.
   */
  order?: { id: string; total?: number | string | null; payments: number } | null
  /** The order the cart's `order_cart` link names: `null` when it names none; omit when not read. */
  linked_order_id?: string | null
  /** The completion's own execution, when it was found. */
  execution?: CompletionExecution | null
  /** Why the order could not be read back, when the read itself failed. */
  read_error?: string | null
}

export type CartCompletionVerdict =
  | { ok: true; order_id: string }
  | { ok: false; reason: CartCompletionRefusalReason; detail: string }

const refuse = (reason: CartCompletionRefusalReason, detail: string): CartCompletionVerdict => ({
  ok: false,
  reason,
  detail,
})

/**
 * Whether a completion yielded an order that may be acted on: an id was handed
 * back; the completion's execution, when known, is `done`; the order is there
 * under that id; the cart's `order_cart` link, when read, names it; its total
 * is known; and it has a payment whenever it owes money. Any payment counts,
 * as in the settlement steps' paid check (SD-53 (f) is its limit). An order
 * that owes nothing needs none: Medusa completes it without authorizing.
 */
export function judgeCartCompletion(evidence: CartCompletionEvidence): CartCompletionVerdict {
  const { cart_id, order_id, order, linked_order_id, execution, read_error } = evidence
  if (!order_id) {
    const left = linked_order_id ? `; the cart is linked to order ${linked_order_id}, which it left without a payment` : ""
    return refuse("no_order_id", `cart ${cart_id}: the cart's completion returned no order id${left}`)
  }
  if (execution && execution.state !== TransactionState.DONE) {
    return refuse(
      "execution_unfinished",
      `cart ${cart_id}: the completion's execution ${executionId(execution)} is ${execution.state}, not done`
    )
  }
  if (read_error) {
    return refuse("order_not_found", `cart ${cart_id}: order ${order_id} could not be read back: ${read_error}`)
  }
  if (!order) {
    return refuse("order_not_found", `cart ${cart_id}: order ${order_id} cannot be read back`)
  }
  if (linked_order_id !== undefined && linked_order_id !== order_id) {
    return refuse(
      "order_cart_mismatch",
      linked_order_id
        ? `cart ${cart_id} is linked to order ${linked_order_id}, not to ${order_id}`
        : `cart ${cart_id} is linked to no order, yet its completion returned ${order_id}`
    )
  }
  if (order.total === undefined || order.total === null) {
    return refuse("order_total_unknown", `cart ${cart_id}: order ${order_id} came back with no total, so whether it owes money is unknown`)
  }
  if (order.payments === 0 && MathBN.gt(order.total, 0)) {
    return refuse(
      "order_unpaid",
      `cart ${cart_id}: order ${order_id} owes ${String(order.total)} and has no payment (its completion stopped before the payment was authorized, or has not got there yet)`
    )
  }
  return { ok: true, order_id }
}

/**
 * The error every refused completion throws. A `MedusaError` of type
 * `unexpected_state`, so a caller that does not know it still gets a refusal
 * (Medusa answers that type with 500, keeping the `code`); the HTTP layer
 * answers it with 409 and the buyer's message. The message is the buyer's;
 * the detail — cart, order and execution ids — is on the error and in the
 * log, never in the response.
 */
export class CartCompletionIncompleteError extends MedusaError {
  readonly reason: CartCompletionRefusalReason
  readonly detail: string
  readonly cart_id: string
  readonly order_id: string | null
  readonly execution_id: string | null

  constructor(input: {
    cart_id: string
    order_id?: string | null
    reason: CartCompletionRefusalReason
    detail: string
    execution?: CompletionExecution | null
  }) {
    super(MedusaError.Types.UNEXPECTED_STATE, CART_COMPLETION_INCOMPLETE_MESSAGE, CART_COMPLETION_INCOMPLETE)
    this.reason = input.reason
    this.detail = input.detail
    this.cart_id = input.cart_id
    this.order_id = input.order_id ?? null
    this.execution_id = input.execution ? executionId(input.execution) : null
  }
}

/** What a refusal looks like once the workflow engine has serialized it: a plain object carrying the code. */
export type CartCompletionIncompleteLike = {
  code: typeof CART_COMPLETION_INCOMPLETE
  message?: string
  reason?: string
}

/**
 * Whether an error is a refused completion. Keyed on the `code`, not the class:
 * the workflow engine serializes a step's error to a plain object before the
 * caller sees it (`serializeError`, which keeps own properties), so
 * `instanceof` does not hold where this is needed most.
 */
export function isCartCompletionIncomplete(error: unknown): error is CartCompletionIncompleteLike {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === CART_COMPLETION_INCOMPLETE
  )
}

const REASONS: ReadonlySet<string> = new Set<CartCompletionRefusalReason>([
  "no_order_id",
  "execution_unfinished",
  "order_not_found",
  "order_cart_mismatch",
  "order_total_unknown",
  "order_unpaid",
])

export type CartCompletionIncompleteBody = {
  code: typeof CART_COMPLETION_INCOMPLETE
  type: typeof CART_COMPLETION_INCOMPLETE
  message: string
  reason?: CartCompletionRefusalReason
}

/**
 * The HTTP answer to a refused completion: 409, the stable code, the buyer's
 * message, and the reason when it is one of ours. No ids: the buyer has the
 * cart; support has the log.
 */
export function cartCompletionIncompleteResponse(error: CartCompletionIncompleteLike): {
  status: typeof CART_COMPLETION_INCOMPLETE_STATUS
  body: CartCompletionIncompleteBody
} {
  const body: CartCompletionIncompleteBody = {
    code: CART_COMPLETION_INCOMPLETE,
    type: CART_COMPLETION_INCOMPLETE,
    message: CART_COMPLETION_INCOMPLETE_MESSAGE,
  }
  if (typeof error.reason === "string" && REASONS.has(error.reason)) {
    body.reason = error.reason as CartCompletionRefusalReason
  }
  return { status: CART_COMPLETION_INCOMPLETE_STATUS, body }
}
