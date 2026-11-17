import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import {
  CART_COMPLETION_INCOMPLETE,
  type CartCompletionEvidence,
  cartCompletionIncompleteResponse,
  judgeCartCompletion,
} from "../../lib/cart-completion"
import { CART_ALREADY_COMPLETED } from "../../lib/cart-payment-amount"
import { createLogger } from "../../shared/logger"
import { runMainCheckoutGuards } from "../../workflows/hooks/complete-cart-guards"

const log = createLogger("api/middlewares/cart-completion-guards")

/**
 * FBM's cart-completion guards on its main checkout, `POST
 * /store/carts/:id/complete` (SD-54, SD-72 (a)).
 *
 * `@mercurjs/b2c-core` 1.5.0 serves that route with
 * `splitAndCompleteCartWorkflow`, which never calls Medusa's
 * `completeCartWorkflow.hooks.validate`, where the guards are registered. Its
 * only hook, `orderSetCreated`, fires after the card is authorized, the orders
 * are written and `completed_at` is set, and again on every re-run: a throw
 * there would compensate a sale, not refuse one. So the guards run here, in
 * front of the route, before Mercur authorizes anything.
 *
 * Which guards: `MAIN_CHECKOUT_GUARDS`, the hook's own list less the ones
 * `NOT_RUN_ON_MAIN_CHECKOUT` names with their reasons
 * (`workflows/hooks/complete-cart-guards.ts`): the sliding-scale tier, the
 * Coalition Credits reservation and the order cycle. Each refuses with
 * `MedusaError` (`not_allowed` or `invalid_data`), which this does not catch:
 * the framework wraps route middlewares and hands the throw to the error
 * handler, which answers both types with 400 and the guard's message, shown
 * to the buyer as it is (`storefront/src/lib/helpers/order-error-formatter.ts`).
 *
 * Three carts are not checked by the guards, each for its own reason:
 *
 * - An `order_set` already exists for the cart. That is the test Mercur's
 *   workflow itself makes before it creates anything (its `order-set-query`):
 *   it then hands the existing order set back. It covers a retry of a placed
 *   order and a completion Medusa's engine left unfinished (SD-53, answered
 *   by `refuseUnfinishedCartCompletion` behind this). On such a cart the
 *   guards would read state the cart's own sale changed: a cycle's sold count
 *   already holds it, so a retry of an order that took a cycle's last units
 *   would be refused. The request goes on to Mercur's route.
 * - `completed_at` is set and no order set exists. Medusa's
 *   `completeCartWorkflow` completed the cart (tickets, rentals, the digital
 *   and subscription checkouts, Medusa's payment webhook) into an order of
 *   its own, and its validate hook ran the guards then; here they would
 *   refuse on the cart's own sale, as above ("sold out"). Nor does the
 *   request go on: Mercur's workflow does not read `completed_at`, and on
 *   Mercur 1.5.0 its run on such a cart fails linking its order to the
 *   cart's payment collection, which Medusa's order already holds (400
 *   "Cannot create multiple links between 'order' and 'payment'"), and its
 *   compensation then cancels the payment Medusa's order was placed on,
 *   calling Stripe's cancel, on every retry alike (SD-72 (b)'s mirror,
 *   measured through `POST /store/carts/:id/complete-digital` and then this
 *   route). It is answered here, and what it is answered depends on the
 *   order the cart's `order_cart` link names, judged as FBM judges every
 *   completion (`judgeCartCompletion`, `lib/cart-completion.ts`, on the
 *   order's total and payment count, read as
 *   `workflows/steps/require-completed-cart-order.ts` reads them). When the
 *   judge says the completion yielded an order that may be acted on (there,
 *   and paid whenever it owes money), 409 `cart_already_completed` with that
 *   order's id, as Medusa's own complete route hands back the order of a
 *   completed cart. Otherwise 409 `cart_completion_incomplete`
 *   (`cartCompletionIncompleteResponse`) with no order id: a Medusa
 *   completion the engine stalled (SD-53) leaves the order, the link and
 *   `completed_at` with no payment and no confirmation email, and one still
 *   running is in that state until it authorizes, so "already placed" would
 *   be false; a retry gets the true answer once the run has ended. A cart
 *   linked to no order gets the same, as the judge refuses a completion that
 *   names none. Mercur's own runs never leave this state: they write the order set
 *   before `completed_at` (`createOrderSetStep` runs before the block that
 *   holds `updateCartsStep`), and their compensation puts `completed_at` back
 *   and deletes the order set (read in `split-and-complete-cart.js` and
 *   core-flows' `update-carts.js`).
 * - A cart that does not exist: Mercur's route answers for it, as before.
 *
 * Fails closed. When the cart, its order sets, a completed cart's order link
 * or that order cannot be read, or a guard fails without refusing (anything
 * but its `not_allowed` or `invalid_data` refusal), the completion does not
 * run and the buyer is answered 409 `cart_completion_check_failed`: the
 * order was not placed, try again shortly. Never "already placed" on
 * evidence that could not be read. Two guards fail open inside on infrastructure errors (the CCR
 * guard's cart read; the order-cycle guard's cart read, its module
 * resolution and its stock read), as they do on the hook; that is theirs,
 * not this middleware's.
 *
 * What this does not close. Mercur's workflow takes no cart lock, so a
 * client racing a line-item write against its own completion can pass here
 * with one cart and complete another. Line-item metadata is buyer-writable,
 * so a line stripped of `order_cycle_id` is not a cycle line here, nor when
 * the sale is recorded. A double submit passes here twice, and Mercur's
 * route answers one request with the order set and the other, which meets
 * the same transaction id, 500 ("Transaction already started", measured in
 * review); should a cycle's last units sell between the two, the later one is
 * refused here instead. And the guards
 * sit on the route, not in the workflow: Medusa's generic admin runner
 * (`POST /admin/workflows-executions/:workflow_id/run`) can run
 * `split-and-complete-cart` directly, past this.
 *
 * Read-only, and only refuses: it resolves the query and, through the
 * guards, the order-cycle module; never a ledger (Posture A).
 */
export async function refuseGuardedCartCompletion(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
): Promise<void> {
  const cartId = String(req.params.id ?? "")

  let state: CompletionState
  try {
    state = await completionStateOf(req.scope, cartId)
  } catch (error) {
    return answerCheckFailed(res, cartId, "its cart or order sets could not be read", error)
  }
  const { query, cart } = state
  if (!cart) return next()

  // Mercur's own re-run test: the order set is there, so its workflow hands
  // it back and creates nothing.
  if (state.hasOrderSet) return next()

  if (cart.completed_at) {
    // Completed by Medusa's completeCartWorkflow, whose validate hook ran the
    // guards at that completion. Answered here: Mercur's run on it would
    // cancel that order's payment. Whether the order was placed is judged on
    // what that completion left.
    let evidence: CartCompletionEvidence
    try {
      evidence = await evidenceOfCompletedCart(query, cartId)
    } catch (error) {
      return answerCheckFailed(res, cartId, "its order link or order could not be read", error)
    }
    const verdict = judgeCartCompletion(evidence)
    if (verdict.ok) {
      const answer = cartAlreadyCompletedAtCheckoutResponse(verdict.order_id)
      log.warn(
        `[cart-completion] cart ${cartId}: POST /store/carts/:id/complete on a cart Medusa's workflow completed into order ${verdict.order_id}; answered ${answer.status} ${answer.body.code}, Mercur not called`,
        { cart_id: cartId, order_id: verdict.order_id }
      )
      res.status(answer.status).json(answer.body)
      return
    }
    const refusal = cartCompletionIncompleteResponse({ code: CART_COMPLETION_INCOMPLETE, reason: verdict.reason })
    log.error(
      `[cart-completion] cart ${cartId}: POST /store/carts/:id/complete on a cart completed without an order set whose completion yielded no order to act on (${verdict.reason}): ${verdict.detail}; answered ${refusal.status} ${refusal.body.code}, Mercur not called`,
      { cart_id: cartId, order_id: evidence.order_id ?? null, reason: verdict.reason }
    )
    res.status(refusal.status).json(refusal.body)
    return
  }

  try {
    await runMainCheckoutGuards({ input: { id: cartId }, cart: { id: cartId, completed_at: null } }, { container: req.scope })
  } catch (error) {
    if (isGuardRefusal(error)) throw error
    return answerCheckFailed(res, cartId, "a guard failed without refusing", error)
  }
  next()
}

/**
 * 409, the status Medusa's own complete route gives a cart it cannot complete
 * now ("already being completed") and the one FBM's other completion refusals
 * use. The code is the one the tier and wholesale routes answer a completed
 * cart with (`CART_ALREADY_COMPLETED`, 400 there, as Medusa's cart writes
 * answer one): the same fact, whichever route met it.
 */
export const CART_ALREADY_COMPLETED_AT_CHECKOUT_STATUS = 409

/**
 * What the buyer is told: the order exists, and where they can see it. Sent
 * only when `judgeCartCompletion` passes the order the cart is linked to
 * (there, its total known, paid whenever it owes money), so that holds; a
 * completion that left an unpaid order, which also sent no confirmation
 * email, gets `cart_completion_incomplete` instead.
 */
export const CART_ALREADY_COMPLETED_AT_CHECKOUT_MESSAGE =
  "Your order for this cart has already been placed. You can find it under Orders in your account, or in your order confirmation email."

/**
 * The answer to a cart Medusa's workflow completed into an order the judge
 * passes. The order's id and no other order data: Medusa's own complete
 * route hands back the whole order of a completed cart to whoever holds the
 * cart's id, which is all this route asks for too.
 */
export function cartAlreadyCompletedAtCheckoutResponse(orderId?: string | null): {
  status: typeof CART_ALREADY_COMPLETED_AT_CHECKOUT_STATUS
  body: { code: typeof CART_ALREADY_COMPLETED; type: typeof CART_ALREADY_COMPLETED; message: string; order_id?: string }
} {
  return {
    status: CART_ALREADY_COMPLETED_AT_CHECKOUT_STATUS,
    body: {
      code: CART_ALREADY_COMPLETED,
      type: CART_ALREADY_COMPLETED,
      message: CART_ALREADY_COMPLETED_AT_CHECKOUT_MESSAGE,
      ...(orderId ? { order_id: orderId } : {}),
    },
  }
}

/** The `code` of a completion refused because the check could not be made. Stable: clients and tests key on it. */
export const CART_COMPLETION_CHECK_FAILED = "cart_completion_check_failed"

/** 409, as the payment-amount check answers a cart it cannot read (`lib/cart-payment-amount.ts`). */
export const CART_COMPLETION_CHECK_FAILED_STATUS = 409

/**
 * What the buyer is told. True whenever it is sent: nothing past this
 * middleware ran, so no order was placed and this request authorized nothing.
 */
export const CART_COMPLETION_CHECK_FAILED_MESSAGE =
  "Your order was not placed, because we could not check your cart just now. Please try again in a moment."

export function cartCompletionCheckFailedResponse(): {
  status: typeof CART_COMPLETION_CHECK_FAILED_STATUS
  body: { code: typeof CART_COMPLETION_CHECK_FAILED; type: typeof CART_COMPLETION_CHECK_FAILED; message: string }
} {
  return {
    status: CART_COMPLETION_CHECK_FAILED_STATUS,
    body: {
      code: CART_COMPLETION_CHECK_FAILED,
      type: CART_COMPLETION_CHECK_FAILED,
      message: CART_COMPLETION_CHECK_FAILED_MESSAGE,
    },
  }
}

/** A guard's refusal: the only failure that is the guard's answer, passed on as it is (400). */
function isGuardRefusal(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !MedusaError.isMedusaError(error)) return false
  const type = (error as { type?: unknown }).type
  return type === MedusaError.Types.NOT_ALLOWED || type === MedusaError.Types.INVALID_DATA
}

function answerCheckFailed(res: MedusaResponse, cartId: string, what: string, error: unknown): void {
  const refusal = cartCompletionCheckFailedResponse()
  log.error(
    `[cart-completion] cart ${cartId}: completion refused, ${what}: ${(error as Error)?.message ?? error}; answered ${refusal.status} ${refusal.body.code}, nothing authorized`,
    { cart_id: cartId }
  )
  res.status(refusal.status).json(refusal.body)
}

type CompletionState = { query: QueryLike; cart?: { id: string; completed_at?: unknown }; hasOrderSet: boolean }

/** The cart, and whether an order set exists for it. A cart that does not exist is read once and nothing else is. */
async function completionStateOf(scope: MedusaRequest["scope"], cartId: string): Promise<CompletionState> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY) as QueryLike
  const { data: carts } = await query.graph({ entity: "cart", fields: ["id", "completed_at"], filters: { id: cartId } })
  const cart = carts[0] as CompletionState["cart"]
  if (!cart) return { query, cart: undefined, hasOrderSet: false }
  const { data: orderSets } = await query.graph({ entity: "order_set", fields: ["id"], filters: { cart_id: cartId } })
  return { query, cart, hasOrderSet: orderSets.length > 0 }
}

type LinkedOrderRow = {
  id: string
  total?: number | string | null
  payment_collections?: Array<{ payments?: Array<{ id: string } | null> | null } | null> | null
}

/**
 * What a completed cart's completion left, for `judgeCartCompletion`: the
 * order its `order_cart` link names (read as `completeCartWorkflow` reads the
 * link), and that order's total and payment count (read as
 * `workflows/steps/require-completed-cart-order.ts` reads them). A cart linked
 * to no order is evidence of none. A read that fails throws: the caller
 * answers that the check could not be made.
 */
async function evidenceOfCompletedCart(query: QueryLike, cartId: string): Promise<CartCompletionEvidence> {
  const { data: links } = await query.graph({ entity: "order_cart", fields: ["cart_id", "order_id"], filters: { cart_id: cartId } })
  const linked = (links[0] as { order_id?: unknown } | undefined)?.order_id
  const orderId = typeof linked === "string" && linked ? linked : null
  if (!orderId) return { cart_id: cartId, order_id: null, linked_order_id: null }

  const { data: orders } = await query.graph({
    entity: "order",
    fields: ["id", "total", "payment_collections.id", "payment_collections.payments.id"],
    filters: { id: orderId },
  })
  const row = orders[0] as LinkedOrderRow | undefined
  const order = row
    ? {
        id: row.id,
        total: row.total,
        payments: (row.payment_collections ?? []).flatMap((c) => c?.payments ?? []).filter((p) => !!p).length,
      }
    : null
  return { cart_id: cartId, order_id: orderId, order, linked_order_id: orderId }
}

type QueryLike = {
  graph: (args: { entity: string; fields: string[]; filters: Record<string, unknown> }) => Promise<{ data: unknown[] }>
}
