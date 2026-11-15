/**
 * What Medusa 2.14.2 hands `completeCartWorkflow.hooks.validate`.
 *
 * `@medusajs/core-flows` `cart/workflows/complete-cart.js` calls
 * `createHook("validate", { input, cart: cartData.data })`, where `input` is
 * the workflow's own input, `CompleteCartWorkflowInput` = `{ id }`, and
 * `cart` is the cart the workflow has just read. Every FBM path that
 * completes a cart this way (tickets, rentals, the digital and subscription
 * checkouts, renewals, and Medusa's payment webhook through
 * `completeCartAfterPaymentStep`) passes `{ id }`.
 *
 * The Coalition Credits and order-cycle guards read `input.cart_id` until
 * SD-54 (docs/AUDIT_DEBT.md), found nothing, and returned before reading the
 * cart, so neither ran at any checkout; their unit spec handed them the shape
 * the code read. `complete-cart-validate.ts` now passes the hook's argument to
 * each guard uncast, so a guard typed against a shape that shares no field
 * with Medusa's (`{ cart_id?: string }` against `{ id: string }`) fails to
 * compile instead of passing a green suite.
 */
export type CompleteCartValidateArgs = {
  input?: { id?: string }
  cart?: unknown
}
