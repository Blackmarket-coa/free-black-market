import { createStep, StepResponse, type StepExecutionContext } from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, Modules, TransactionState } from "@medusajs/framework/utils"
import { completeCartWorkflowId } from "@medusajs/medusa/core-flows"
import { createLogger } from "../../shared/logger"
import {
  type CartCompletionEvidence,
  CartCompletionIncompleteError,
  type CompletionExecution,
  executionId,
  judgeCartCompletion,
} from "../../lib/cart-completion"

const log = createLogger("workflows/steps/require-completed-cart-order")

export const requireCompletedCartOrderStepId = "require-completed-cart-order"

export type RequireCompletedCartOrderInput = {
  cart_id: string
  /** What `completeCartWorkflow.runAsStep` handed back as the order's id, if anything. */
  order_id: string | null | undefined
}

/**
 * The transaction id `runAsStep` gives a nested `completeCartWorkflow` run:
 * the nested step's name, a dash, the parent's transaction id (workflows-sdk
 * 2.14.2, `buildTransactionId`; a retried step appends `-attempt-N`, and no
 * FBM workflow retries this one). The completion's execution is read under it.
 */
export function nestedCompleteCartTransactionId(parentTransactionId: string): string {
  return `${completeCartWorkflowId}-as-step-${parentTransactionId}`
}

/** Every state that is not an end state: still running, stuck, or never begun. */
const UNFINISHED_STATES = [
  TransactionState.NOT_STARTED,
  TransactionState.INVOKING,
  TransactionState.WAITING_TO_COMPENSATE,
  TransactionState.COMPENSATING,
]

/** How many of the newest unfinished completions the fallback lookup reads. */
const UNFINISHED_SCAN_LIMIT = 25

type ExecutionRow = CompletionExecution & {
  context?: { data?: { payload?: { id?: string } | null } | null } | null
}
type EngineLike = {
  listWorkflowExecutions: (filters: Record<string, unknown>, config?: Record<string, unknown>) => Promise<ExecutionRow[]>
}
type QueryLike = { graph: (q: Record<string, unknown>) => Promise<{ data: unknown[] }> }

const pick = (row: ExecutionRow): CompletionExecution => ({
  id: row.id ?? null,
  workflow_id: row.workflow_id,
  transaction_id: row.transaction_id,
  state: row.state,
})

/**
 * The completion's own `workflow_execution` row: under the transaction id
 * `runAsStep` gave it, or, failing that, the unfinished `complete-cart`
 * execution whose input names this cart — the engine's own record of a
 * stall. `completeCartWorkflow` is stored (`store: true`, three days), so a
 * finished nested run leaves a `done` row and a stalled one an unfinished one.
 */
async function findCompletionExecution(
  engine: EngineLike | undefined,
  cartId: string,
  parentTransactionId: string | undefined
): Promise<CompletionExecution | null> {
  if (!engine) return null
  if (parentTransactionId) {
    const rows = await engine.listWorkflowExecutions(
      { workflow_id: completeCartWorkflowId, transaction_id: nestedCompleteCartTransactionId(parentTransactionId) },
      { select: ["id", "workflow_id", "transaction_id", "state"], order: { created_at: "DESC" }, take: 1 }
    )
    if (rows[0]) return pick(rows[0])
  }
  // Bounded: this runs on every completion whose nested row is gone, which
  // is every one that finished (a finished run's row is deleted), and
  // stalled rows stay until an operator clears them. This cart's own run is
  // the newest unfinished one when its checkout has just run it; if it were
  // ever missed, the order read-back below still decides.
  const unfinished = await engine.listWorkflowExecutions(
    { workflow_id: completeCartWorkflowId, state: UNFINISHED_STATES },
    {
      select: ["id", "workflow_id", "transaction_id", "state", "context"],
      order: { created_at: "DESC" },
      take: UNFINISHED_SCAN_LIMIT,
    }
  )
  const mine = unfinished.find((row) => row.context?.data?.payload?.id === cartId)
  return mine ? pick(mine) : null
}

type OrderRow = {
  id: string
  total?: number | string | null
  payment_collections?: Array<{ payments?: Array<{ id: string } | null> | null } | null> | null
}

/** The order by the id the completion handed back, and the order the cart's `order_cart` link names. */
async function readBack(
  query: QueryLike,
  cartId: string,
  orderId: string
): Promise<Pick<CartCompletionEvidence, "order" | "linked_order_id">> {
  const [{ data: orders }, { data: links }] = await Promise.all([
    // Not the paid step's field list: the settlement specs tell that step's
    // read apart by it.
    query.graph({
      entity: "order",
      fields: ["id", "total", "payment_collections.id", "payment_collections.payments.id"],
      filters: { id: orderId },
    }),
    query.graph({ entity: "order_cart", fields: ["cart_id", "order_id"], filters: { cart_id: cartId } }),
  ])
  const row = (orders as Array<OrderRow | null>)[0]
  const order = row
    ? {
        id: row.id,
        total: row.total,
        payments: (row.payment_collections ?? []).flatMap((c) => c?.payments ?? []).filter((p) => !!p).length,
      }
    : null
  const link = (links as Array<{ order_id?: string | null } | null>)[0]
  return { order, linked_order_id: link?.order_id ?? null }
}

async function linkedOrderIdOrNull(query: QueryLike, cartId: string): Promise<string | null> {
  try {
    const { data } = await query.graph({ entity: "order_cart", fields: ["cart_id", "order_id"], filters: { cart_id: cartId } })
    return (data as Array<{ order_id?: string | null } | null>)[0]?.order_id ?? null
  } catch {
    return null
  }
}

/**
 * Right after `completeCartWorkflow.runAsStep`, on every FBM path that
 * completes a cart (SD-53): the completion must have yielded an order — an id
 * handed back, its own execution `done`, the order there under that id and
 * named by the cart's `order_cart` link, with a payment if it owes money — or
 * the workflow is refused here, before anything reads by an id that is not
 * there, delivers, provisions, grants, settles or captures. Unconditional:
 * no feature flag is read. The refusal is `CartCompletionIncompleteError`
 * (`lib/cart-completion.ts`), answered 409 `cart_completion_incomplete` by the
 * HTTP layer, and logged here at error level with the cart id and the
 * completion's execution id.
 *
 * The order read is the one read that decides: a read that fails refuses
 * (`order_not_found`), as an order that cannot be read back is not one to act
 * on. The execution lookup is evidence and context: when it finds the run and
 * the run is not `done`, that refuses too; when it finds nothing, the order
 * read-back decides, so a completion whose execution row the engine has
 * already dropped is not refused for it. With no order id the refusal is
 * decided before anything is read; the link is read only to say which order
 * the stall left behind, for the operator.
 *
 * What is left behind is left as it is: the order, the `order_cart` link and
 * the cart's `completed_at`. A retry on that cart gets the same order back
 * from `completeCartWorkflow` (idempotent on the link) and is refused here
 * again (`order_unpaid`), so nothing is delivered for it and no second order
 * is made; it stays for an operator to cancel (SD-48 open item (o)).
 */
export const requireCompletedCartOrderStep = createStep(
  requireCompletedCartOrderStepId,
  async (input: RequireCompletedCartOrderInput, context: StepExecutionContext) => {
    const { container, transactionId, workflowId } = context
    const orderId = input.order_id || null
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as unknown as QueryLike
    const engine = container.resolve(Modules.WORKFLOW_ENGINE, { allowUnregistered: true }) as EngineLike | undefined

    let execution: CompletionExecution | null = null
    try {
      execution = await findCompletionExecution(engine, input.cart_id, transactionId)
    } catch (error) {
      log.warn(
        `[cart-completion] cart ${input.cart_id}: could not read the completion's execution: ${(error as Error)?.message ?? error}`
      )
    }

    const evidence: CartCompletionEvidence = { cart_id: input.cart_id, order_id: orderId, execution }
    if (orderId) {
      try {
        Object.assign(evidence, await readBack(query, input.cart_id, orderId))
      } catch (error) {
        evidence.read_error = (error as Error)?.message ?? String(error)
      }
    } else {
      evidence.linked_order_id = await linkedOrderIdOrNull(query, input.cart_id)
    }

    const verdict = judgeCartCompletion(evidence)
    if (!verdict.ok) {
      const refusal = new CartCompletionIncompleteError({
        cart_id: input.cart_id,
        order_id: orderId,
        reason: verdict.reason,
        detail: verdict.detail,
        execution,
      })
      log.error(`[cart-completion] refused (${verdict.reason}): ${verdict.detail}; nothing delivered`, {
        cart_id: input.cart_id,
        order_id: orderId,
        linked_order_id: evidence.linked_order_id ?? null,
        execution_id: execution ? executionId(execution) : null,
        execution_row_id: execution?.id ?? null,
        execution_state: execution?.state ?? null,
        workflow_id: workflowId,
        transaction_id: transactionId ?? null,
      })
      throw refusal
    }
    return new StepResponse({ order_id: verdict.order_id })
  }
)
