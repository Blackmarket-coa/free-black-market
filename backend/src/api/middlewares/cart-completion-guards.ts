import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { runMainCheckoutGuards } from "../../workflows/hooks/complete-cart-guards"

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
 * Two carts are not checked, for different reasons:
 *
 * - An `order_set` already exists for the cart. That is the test Mercur's
 *   workflow itself makes before it creates anything (its `order-set-query`):
 *   it then hands the existing order set back. It covers a retry of a placed
 *   order and a completion Medusa's engine left unfinished (SD-53, answered
 *   by `refuseUnfinishedCartCompletion` behind this). On such a cart the
 *   guards would read state the cart's own sale changed: a cycle's sold count
 *   already holds it, so a retry of an order that took a cycle's last units
 *   would be refused.
 * - `completed_at` is set and no order set exists. Medusa's
 *   `completeCartWorkflow` completed the cart (tickets, rentals, the digital
 *   and subscription checkouts, Medusa's payment webhook), and its validate
 *   hook ran the guards then. Checking again would refuse on the cart's own
 *   sale, as above. Mercur's workflow does not read `completed_at`: it goes
 *   on with such a cart as with any other, which is SD-72 (b)'s mirror image
 *   and is left as it was.
 *
 * A cart that does not exist is not checked either: Mercur's route answers
 * for it, as before.
 *
 * Fails closed on its own reads. When the cart or its order sets cannot be
 * read, the error goes to the error handler and the completion does not run.
 * Two guards fail open inside on infrastructure errors (the CCR guard's cart
 * read; the order-cycle guard's cart read, its module resolution and its
 * stock read), as they do on the hook; that is theirs, not this
 * middleware's.
 *
 * What this does not close. Mercur's workflow takes no cart lock, so a
 * client racing a line-item write against its own completion can pass here
 * with one cart and complete another. Line-item metadata is buyer-writable,
 * so a line stripped of `order_cycle_id` is not a cycle line here, nor when
 * the sale is recorded. A double submit's second request can be refused here
 * while the first request's run goes on to place the order. And the guards
 * sit on the route, not in the workflow: Medusa's generic admin runner
 * (`POST /admin/workflows-executions/:workflow_id/run`) can run
 * `split-and-complete-cart` directly, past this.
 *
 * Read-only, and only refuses: it resolves the query and, through the
 * guards, the order-cycle module; never a ledger (Posture A).
 */
export async function refuseGuardedCartCompletion(
  req: MedusaRequest,
  _res: MedusaResponse,
  next: MedusaNextFunction
): Promise<void> {
  const cartId = String(req.params.id ?? "")
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as QueryLike

  const { data: carts } = await query.graph({ entity: "cart", fields: ["id", "completed_at"], filters: { id: cartId } })
  const cart = carts[0] as { id: string; completed_at?: unknown } | undefined
  if (!cart) return next()

  const { data: orderSets } = await query.graph({ entity: "order_set", fields: ["id"], filters: { cart_id: cartId } })
  // Mercur's own re-run test: the order set is there, so its workflow hands
  // it back and creates nothing.
  if (orderSets.length > 0) return next()
  // Completed by Medusa's completeCartWorkflow, whose validate hook ran the
  // guards at that completion.
  if (cart.completed_at) return next()

  await runMainCheckoutGuards({ input: { id: cartId }, cart: { id: cartId, completed_at: null } }, { container: req.scope })
  next()
}

type QueryLike = {
  graph: (args: { entity: string; fields: string[]; filters: Record<string, unknown> }) => Promise<{ data: unknown[] }>
}
