import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { createLogger } from "../../shared/logger"
import {
  CART_COMPLETION_INCOMPLETE,
  cartCompletionIncompleteResponse,
  type CompletionExecution,
  executionId,
  isExecutionUnfinished,
} from "../../lib/cart-completion"

const log = createLogger("api/middlewares/cart-completion-finished")

/**
 * The workflow behind FBM's main checkout, `POST /store/carts/:id/complete`:
 * `@mercurjs/b2c-core` overrides Medusa's route with its own, which runs this
 * workflow with the cart id as the transaction id (`context: { transactionId:
 * cart_id }`) and answers with the order set it names.
 */
export const SPLIT_AND_COMPLETE_CART_WORKFLOW_ID = "split-and-complete-cart"

type EngineLike = {
  listWorkflowExecutions: (
    filters: Record<string, unknown>,
    config?: Record<string, unknown>
  ) => Promise<CompletionExecution[]>
}

/**
 * The cart's completion when its execution is still unfinished, else null.
 *
 * The workflow is idempotent, so the engine stores its executions. A finished
 * run has no retention time and no parent step, so the engine deletes its row
 * when the run ends; a row that is still there, in a state that is not an end
 * state, is a run the engine left unfinished (SD-53). Read, not assumed: the
 * row is keyed by the cart id Mercur's route hands the workflow.
 */
export async function unfinishedCompletionOf(
  scope: MedusaRequest["scope"],
  cartId: string
): Promise<CompletionExecution | null> {
  const engine = scope.resolve(Modules.WORKFLOW_ENGINE, { allowUnregistered: true }) as EngineLike | undefined
  if (!engine || !cartId) return null
  const rows = await engine.listWorkflowExecutions(
    { workflow_id: SPLIT_AND_COMPLETE_CART_WORKFLOW_ID, transaction_id: cartId },
    { select: ["id", "workflow_id", "transaction_id", "state"], order: { created_at: "DESC" }, take: 1 }
  )
  const row = rows[0]
  return row && isExecutionUnfinished(row.state) ? row : null
}

const isOrderSetAnswer = (body: unknown): boolean =>
  typeof body === "object" && body !== null && "order_set" in (body as Record<string, unknown>)

/**
 * `POST /store/carts/:id/complete` (SD-53): when Medusa's workflow engine
 * leaves Mercur's completion unfinished, the route still answers 200 with the
 * order set. The order set and its orders are created before the block the
 * engine stops in, and the route's result is a transform that resolves from
 * what has run, so the stall is invisible to it. Medusa's own route, the one
 * Mercur overrides, checks `transaction.hasFinished()` and answers 409.
 *
 * This restores that answer without touching Mercur's handler: the response
 * body it is about to send is held, the completion's execution is read, and
 * an unfinished one is answered 409 `cart_completion_incomplete` instead,
 * logged at error level with the cart and execution ids. The buyer is told
 * nothing was taken: the card is authorized (Mercur authorizes before it
 * creates the orders) but the run's events, `order_set.placed` among them,
 * are released only when the run finishes, so Mercur's capture never runs for
 * a stalled one, and the authorization lapses. A retry on the same cart
 * resumes that execution — the route reuses the cart id as the transaction id —
 * which is why the message says to try again.
 *
 * Only an `order_set` answer is checked: errors keep their own answers. When
 * the execution cannot be read at all, the route's answer stands and the
 * failure to check is logged; refusing on that would say "nothing was taken"
 * about a completion that may well have finished.
 */
export function refuseUnfinishedCartCompletion(req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction): void {
  const cartId = String(req.params.id ?? "")
  const json = res.json.bind(res)
  res.json = ((body: unknown) => {
    if (!isOrderSetAnswer(body)) return json(body)
    void unfinishedCompletionOf(req.scope, cartId)
      .then((unfinished) => {
        if (!unfinished) return json(body)
        const refusal = cartCompletionIncompleteResponse({
          code: CART_COMPLETION_INCOMPLETE,
          reason: "execution_unfinished",
        })
        log.error(
          `[cart-completion] cart ${cartId}: POST /store/carts/:id/complete answered with an order set while its completion ${executionId(unfinished)} is ${unfinished.state}; answered ${refusal.status} ${refusal.body.code} instead, nothing delivered`,
          {
            cart_id: cartId,
            execution_id: executionId(unfinished),
            execution_row_id: unfinished.id ?? null,
            execution_state: unfinished.state,
          }
        )
        res.status(refusal.status)
        return json(refusal.body)
      })
      .catch((error: unknown) => {
        log.error(
          `[cart-completion] cart ${cartId}: could not read the completion's execution, so the route's answer stands: ${(error as Error)?.message ?? error}`
        )
        return json(body)
      })
    return res
  }) as MedusaResponse["json"]
  next()
}
