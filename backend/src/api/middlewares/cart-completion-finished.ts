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

/**
 * How long an unfinished completion is given to finish before it is read as
 * stalled. An execution still running is not a stall: a second request for
 * the same cart (a double submit) resumes the first's transaction, does
 * nothing while the first runs its steps, and answers at once. What the first
 * has left by then — the card's authorization at Stripe, the orders, the
 * parallel block — takes seconds; a stall never ends.
 */
export const CART_COMPLETION_SETTLE_MS = 10_000
const POLL_MS = 250

type EngineLike = {
  listWorkflowExecutions: (
    filters: Record<string, unknown>,
    config?: Record<string, unknown>
  ) => Promise<CompletionExecution[]>
}

/**
 * The cart's completion when its execution is still unfinished after
 * `settleMs`, else null.
 *
 * The workflow is idempotent, so the engine stores its executions. A run that
 * ends — done, failed or reverted — has no retention time and no parent step,
 * so the engine deletes its row when it ends; a row still there, in a state
 * that is not an end state, is a run that has not ended (SD-53). The
 * in-memory engine writes the row when the run begins and not again until it
 * ends, so a stalled run's row says `not_started` (seen on a real database;
 * its state in memory is `invoking`). Read, not assumed: the row is keyed by
 * the cart id Mercur's route hands the workflow.
 */
export async function unfinishedCompletionOf(
  scope: MedusaRequest["scope"],
  cartId: string,
  settleMs = CART_COMPLETION_SETTLE_MS
): Promise<CompletionExecution | null> {
  const engine = scope.resolve(Modules.WORKFLOW_ENGINE, { allowUnregistered: true }) as EngineLike | undefined
  if (!engine || !cartId) return null
  const read = async (): Promise<CompletionExecution | null> => {
    const rows = await engine.listWorkflowExecutions(
      { workflow_id: SPLIT_AND_COMPLETE_CART_WORKFLOW_ID, transaction_id: cartId },
      { select: ["id", "workflow_id", "transaction_id", "state"], order: { created_at: "DESC" }, take: 1 }
    )
    const row = rows[0]
    return row && isExecutionUnfinished(row.state) ? row : null
  }
  const until = Date.now() + settleMs
  let unfinished = await read()
  while (unfinished && Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
    unfinished = await read()
  }
  return unfinished
}

const statusOf = (res: MedusaResponse): number => (res as unknown as { statusCode?: number }).statusCode ?? 200

/**
 * `POST /store/carts/:id/complete` (SD-53): when Medusa's workflow engine
 * leaves Mercur's completion unfinished, Mercur's route has no answer of its
 * own for it. Medusa's route, the one Mercur overrides, checks
 * `transaction.hasFinished()` and answers 409; Mercur's resolves its result
 * from what has run. On a real database a stalled run made it answer 500
 * `unknown_error` (its result transform reads the order set's id off
 * `undefined`); by reading, a stall whose order set resolves would be
 * answered 200 with that order set.
 *
 * Whatever the route answers, this holds the answer, reads the completion's
 * execution, and when it is still unfinished after `settleMs` answers 409
 * `cart_completion_incomplete` instead, logged at error level with the cart
 * and execution ids. The buyer is told nothing was taken: the card is
 * authorized (Mercur authorizes before it creates the orders) but the run's
 * events, `order_set.placed` among them, are released only when the run
 * ends, so Mercur's capture never runs for a stalled one, and the
 * authorization lapses. A completion that ended passes its answer through,
 * errors and all: Mercur's own refusals end its run (its row is deleted)
 * before they are answered.
 *
 * When the execution cannot be read at all, the route's answer stands and the
 * failure to check is logged; refusing on that would say "nothing was taken"
 * about a completion that may well have finished.
 */
export function refuseUnfinishedCartCompletionAfter(settleMs: number) {
  return function refuseUnfinishedCartCompletion(req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction): void {
    const cartId = String(req.params.id ?? "")
    const json = res.json.bind(res)
    res.json = ((body: unknown) => {
      const answered = statusOf(res)
      void unfinishedCompletionOf(req.scope, cartId, settleMs)
        .then((unfinished) => {
          if (!unfinished) return json(body)
          const refusal = cartCompletionIncompleteResponse({
            code: CART_COMPLETION_INCOMPLETE,
            reason: "execution_unfinished",
          })
          log.error(
            `[cart-completion] cart ${cartId}: POST /store/carts/:id/complete answered ${answered} while its completion ${executionId(unfinished)} was still ${unfinished.state} after ${settleMs}ms; answered ${refusal.status} ${refusal.body.code} instead, nothing delivered`,
            {
              cart_id: cartId,
              execution_id: executionId(unfinished),
              execution_row_id: unfinished.id ?? null,
              execution_state: unfinished.state,
              route_status: answered,
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
}

export const refuseUnfinishedCartCompletion = refuseUnfinishedCartCompletionAfter(CART_COMPLETION_SETTLE_MS)
