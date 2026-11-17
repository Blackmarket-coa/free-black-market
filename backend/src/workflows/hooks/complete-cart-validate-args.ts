/**
 * What Medusa 2.14.2 hands `completeCartWorkflow.hooks.validate`.
 *
 * `@medusajs/core-flows` `cart/workflows/complete-cart.js` calls
 * `createHook("validate", { input, cart: cartData.data })`, where `input` is
 * the workflow's own input, `CompleteCartWorkflowInput` = `{ id }`, and
 * `cart` is the cart the workflow has just read (`completeCartFields`, which
 * include `completed_at`). Every FBM path that completes a cart this way
 * (tickets, rentals, the digital and subscription checkouts, renewals, and
 * Medusa's payment webhook through `completeCartAfterPaymentStep`) passes
 * `{ id }`. The middleware in front of Mercur's main checkout, which never
 * calls the hook, hands its guards the same shape
 * (`api/middlewares/cart-completion-guards.ts`).
 *
 * The Coalition Credits and order-cycle guards read `input.cart_id` until
 * SD-54 (docs/AUDIT_DEBT.md), found nothing, and returned before reading the
 * cart, so neither ran at any checkout; their unit spec handed them the shape
 * the code read. `complete-cart-guards.ts` now passes this argument to each of
 * them uncast. That makes tsc refuse a guard whose argument shares no field
 * with this type: the original `{ input?: { cart_id?: string } }` fails to
 * compile (TS2345). It does not catch every wrong read. A guard typed
 * `{ input?: { id?: string; cart_id?: string } }` that reads `cart_id` still
 * compiles. The proof that each guard reads the right cart is in its unit spec,
 * which records which cart id the guard asked for, and in
 * `integration-tests/http/complete-cart-validate-guards.spec.ts`, which runs
 * Medusa's workflow on real carts.
 */
export type CompleteCartValidateArgs = {
  input?: { id?: string }
  cart?: unknown
}

/**
 * Whether the cart the hook was handed has already completed.
 *
 * Medusa runs the validate hook on every run of `completeCartWorkflow`, before
 * the workflow looks at the cart's existing order: `createHook("validate")`
 * comes before `when("create-order", ...)` in `complete-cart.js`. So a re-run
 * on a cart that already completed runs the guards again. That happens on a
 * retried checkout, on the digital and subscription replays with their flag
 * off, and on Medusa's payment webhook, which re-runs the workflow for any cart
 * with a payment collection and no `order_cart` link (Mercur's split checkout
 * writes none). On that run the guards read state the completion itself
 * changed: an order cycle's sold count already holds this cart's own sale, and
 * a rental's booking already overlaps its own dates. They also read state that
 * moved since: the cycle may have closed or been dispatched. A refusal then
 * cannot undo the sale. It fails the retry, and it runs the workflow's
 * `compensatePaymentIfNeededStep` compensation, which tries to refund a
 * captured payment.
 *
 * `completed_at` is written by the completion that made the order: by
 * `completeCartWorkflow` (`updateCartsStep`, alongside the `order_cart` link)
 * and by Mercur's `splitAndCompleteCartWorkflow` (`updateCartsStep`, alongside
 * its order-set links). No FBM store route writes it.
 */
export function cartAlreadyCompleted(args: CompleteCartValidateArgs | undefined): boolean {
  const cart = args?.cart as { completed_at?: unknown } | null | undefined
  return Boolean(cart?.completed_at)
}
