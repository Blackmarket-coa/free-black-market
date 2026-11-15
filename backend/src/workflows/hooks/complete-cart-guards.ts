import { validateSlidingScaleTier } from "./validate-sliding-scale-tier"
import { validateRentalOnCompleteCart } from "../rental/hooks/validate-rental"
import { validateCcrReservation } from "./validate-ccr-reservation"
import { validateOrderCycleOnCompleteCart } from "./validate-order-cycle"
import { cartAlreadyCompleted, type CompleteCartValidateArgs } from "./complete-cart-validate-args"

/**
 * The guards FBM runs on `completeCartWorkflow.hooks.validate`, in order.
 * `complete-cart-validate.ts` registers this as the hook's one handler.
 *
 * Each guard throws `MedusaError` to refuse the checkout. All four are
 * read-only, so their order does not change what is refused, only which
 * message a cart that fails several of them gets.
 *
 * A cart that has already completed is not checked at all
 * (`cartAlreadyCompleted`). Medusa runs this hook on every run of the
 * workflow, re-runs included. On a re-run the sale these guards exist to stop
 * has already happened, and what they read is state that sale changed, so a
 * refusal there would fail the retry and run the workflow's refund
 * compensation on a captured payment for an order that stands. (A cart Mercur completed has no `order_cart` link, so
 * Medusa's workflow does not find its order; what a re-run does with such a
 * cart is a separate question, recorded under SD-54. Stopping a second order
 * is not what these guards check.) The check sits here, once, rather than in
 * each guard, so that a guard added to this list gets it without having to
 * know about it.
 *
 * The CCR and order-cycle guards get the argument uncast (see
 * `CompleteCartValidateArgs` for what that does and does not catch). The
 * sliding-scale and rental guards predate that type and are still cast.
 */
export async function runCompleteCartGuards(
  args: CompleteCartValidateArgs,
  context: { container?: any }
): Promise<void> {
  if (cartAlreadyCompleted(args)) return

  await validateSlidingScaleTier(args as any, context as any)
  await validateRentalOnCompleteCart(args as any, context as any)
  await validateCcrReservation(args, context)
  await validateOrderCycleOnCompleteCart(args, context)
}
