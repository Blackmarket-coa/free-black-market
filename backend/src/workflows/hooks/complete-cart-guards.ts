import { validateSlidingScaleTier } from "./validate-sliding-scale-tier"
import { validateRentalOnCompleteCart } from "../rental/hooks/validate-rental"
import { validateCcrReservation } from "./validate-ccr-reservation"
import { validateOrderCycleOnCompleteCart } from "./validate-order-cycle"
import { validateCartPaymentAmount } from "./validate-cart-payment-amount"
import { cartAlreadyCompleted, type CompleteCartValidateArgs } from "./complete-cart-validate-args"

/**
 * FBM's cart-completion guards, one list, and the two seams that run it.
 *
 * Each guard throws `MedusaError` to refuse the checkout. All five are
 * read-only, so their order does not change what is refused, only which
 * message a cart that fails several of them gets. The payment-amount guard
 * (SD-115) is last: the four before it say whether this sale may happen at
 * all, and it says whether the payment on the cart is the one for it.
 *
 * - `runCompleteCartGuards` runs all of them on
 *   `completeCartWorkflow.hooks.validate` (`complete-cart-validate.ts`
 *   registers it as the hook's one handler): every checkout built on
 *   Medusa's workflow.
 * - `runMainCheckoutGuards` runs `MAIN_CHECKOUT_GUARDS` from the middleware
 *   in front of FBM's main checkout, `POST /store/carts/:id/complete`
 *   (`api/middlewares/cart-completion-guards.ts`). Mercur serves that route
 *   with `splitAndCompleteCartWorkflow`, which never calls Medusa's hook
 *   (SD-54, SD-72 (a)). Its list is this one minus the guards named in
 *   `NOT_RUN_ON_MAIN_CHECKOUT`, each with the reason, so a guard added here
 *   runs at the main checkout too unless it is excluded there on purpose
 *   (`__tests__/complete-cart-guards.unit.spec.ts` pins both lists).
 *
 * A cart that has already completed is not checked at all
 * (`cartAlreadyCompleted`). Medusa runs this hook on every run of the
 * workflow, re-runs included. On a re-run the sale these guards exist to stop
 * has already happened, and what they read is state that sale changed, so a
 * refusal there would fail the retry and run the workflow's refund
 * compensation on a captured payment for an order that stands. (A cart Mercur
 * completed has no `order_cart` link, so Medusa's workflow does not find its
 * order; what a re-run does with such a cart is a separate question, recorded
 * under SD-72 (b). Stopping a second order is not what these guards check.)
 * The check sits here, once, rather than in each guard, so that a guard added
 * to the list gets it without having to know about it.
 *
 * Every guard is called, not referenced: each entry's `run` calls its guard
 * with the composition's argument. For the CCR, order-cycle and
 * payment-amount guards that call is uncast, so tsc refuses a guard whose
 * argument shares no field with `CompleteCartValidateArgs` (see that type),
 * whatever the compiler's settings. A bare reference in the list would be
 * checked by another rule, which depends on them: with `strictFunctionTypes`
 * on (as `--strict` sets it), the original `{ input?: { cart_id?: string } }`
 * guard type-checks as a list element (tried with this repo's tsc). The
 * sliding-scale and rental guards predate that type and are still cast.
 */

type GuardContext = { container?: any }

export type CompleteCartGuardName = "sliding-scale-tier" | "rental" | "ccr-reservation" | "order-cycle" | "payment-amount"

export type CompleteCartGuard = {
  name: CompleteCartGuardName
  run: (args: CompleteCartValidateArgs, context: GuardContext) => Promise<void>
}

/** Every guard, in the order `completeCartWorkflow.hooks.validate` runs them. */
export const COMPLETE_CART_GUARDS: readonly CompleteCartGuard[] = [
  { name: "sliding-scale-tier", run: (args, context) => validateSlidingScaleTier(args as any, context as any) },
  { name: "rental", run: (args, context) => validateRentalOnCompleteCart(args as any, context as any) },
  { name: "ccr-reservation", run: (args, context) => validateCcrReservation(args, context) },
  { name: "order-cycle", run: (args, context) => validateOrderCycleOnCompleteCart(args, context) },
  { name: "payment-amount", run: (args, context) => validateCartPaymentAmount(args, context) },
]

/**
 * The guards the main checkout does not run, and why. Everything else in
 * `COMPLETE_CART_GUARDS` runs there.
 */
export const NOT_RUN_ON_MAIN_CHECKOUT: Readonly<Partial<Record<CompleteCartGuardName, string>>> = {
  rental:
    "Operator decision pending (SD-54 decision 1, option C). The storefront has no rental UI (nothing in it " +
    "calls /store/rentals or /store/carts/:id/line-items/rentals), so a product with an active rental " +
    "configuration sells at the main checkout as an ordinary product; the rental guard would refuse every such " +
    "line that lacks quantity 1, rental dates and a free period, making those products unsellable there. " +
    "Rentals complete through POST /store/rentals/:cart_id, which runs Medusa's workflow and so this guard.",
  "payment-amount":
    "Made for this route by its own middleware, refuseCompletionOnPaymentAmountMismatch " +
    "(api/middlewares/cart-payment-refresh.ts, SD-115), which reads the cart's total and sessions itself and " +
    "puts a refused cart's payment side right. The hook guard judges the cart Medusa's workflow read, which " +
    "this route never hands it.",
}

/** What the main checkout runs: the list above, in its order, less `NOT_RUN_ON_MAIN_CHECKOUT`. */
export const MAIN_CHECKOUT_GUARDS: readonly CompleteCartGuard[] = COMPLETE_CART_GUARDS.filter(
  (guard) => !(guard.name in NOT_RUN_ON_MAIN_CHECKOUT)
)

async function runGuards(
  guards: readonly CompleteCartGuard[],
  args: CompleteCartValidateArgs,
  context: GuardContext
): Promise<void> {
  if (cartAlreadyCompleted(args)) return
  // In order, one at a time: the first refusal is the answer and the later
  // guards do not run.
  for (const guard of guards) {
    await guard.run(args, context)
  }
}

/** The hook's handler: every guard. */
export async function runCompleteCartGuards(args: CompleteCartValidateArgs, context: GuardContext): Promise<void> {
  await runGuards(COMPLETE_CART_GUARDS, args, context)
}

/**
 * The main checkout's guards, for the middleware in front of Mercur's
 * `POST /store/carts/:id/complete`. It hands them the argument the hook would
 * get, `{ input: { id }, cart: { id, completed_at } }`: the guards it runs
 * read the cart by `input.id`.
 */
export async function runMainCheckoutGuards(args: CompleteCartValidateArgs, context: GuardContext): Promise<void> {
  await runGuards(MAIN_CHECKOUT_GUARDS, args, context)
}
