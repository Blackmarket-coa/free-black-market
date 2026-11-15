import { completeCartWorkflow } from "@medusajs/medusa/core-flows"

import { runCompleteCartGuards } from "./complete-cart-guards"

/**
 * Single `completeCartWorkflow.hooks.validate` handler.
 *
 * Medusa v2 allows only one handler per workflow hook, so the
 * sliding-scale-tier and rental validators (previously each
 * self-registering on this hook, which crashed app boot with
 * "Cannot define multiple hook handlers for the validate hook") are
 * composed in `complete-cart-guards.ts` and run in sequence, with the
 * Coalition Credits and order-cycle (D9-1/D9-3) guards after them.
 *
 * On a cart's first completion this hook runs after the cart is final and
 * before the workflow creates the order or authorizes the payment session, so
 * on a checkout that pays inside the workflow a refusal here takes no money.
 * Medusa's payment webhook is the exception: on a Stripe success event it
 * captures before it runs the workflow, so a refusal there leaves a captured
 * payment for the workflow's compensation to try to refund, which is what a
 * cart that never completed should get. And all of this holds only for a
 * first completion.
 * Medusa runs the hook on every run of the workflow, and on a re-run of a
 * completed cart the order already exists, and if the hook refused, the
 * workflow's compensation would try to refund a captured payment. So the
 * composition checks nothing on a completed cart (`cartAlreadyCompleted`,
 * SD-54 follow-up).
 *
 * The hook runs only on checkouts built on `completeCartWorkflow`. FBM's
 * main checkout, `POST /store/carts/:id/complete` (Mercur's
 * `splitAndCompleteCartWorkflow`), never calls it, so none of the four
 * guards runs there (SD-54, open).
 *
 * The hook's argument goes to the composition uncast. Before SD-54 the CCR
 * and order-cycle guards were called through `as any` while reading
 * `input.cart_id`, a field Medusa never passes, so neither ran at any
 * checkout and nothing said so (`complete-cart-validate-args.ts`).
 */
completeCartWorkflow.hooks.validate(async (args, context) => {
  await runCompleteCartGuards(args, context)
})
