/**
 * What the storefront does with the main checkout's refusals,
 * `POST /store/carts/:id/complete` (backend SD-147,
 * `backend/src/api/middlewares/cart-completion-guards.ts` and
 * `backend/src/lib/cart-completion.ts`). The codes are the backend's and are
 * stable: its tests and this file key on them.
 *
 * - `cart_already_completed` (409): the cart is already an order, placed on
 *   another path (Medusa's own completion: the digital, ticket and
 *   subscription checkouts, the payment webhook). The body carries that
 *   order's `order_id` whenever the backend's judge passed it. The cart
 *   cannot be changed or checked out again, so the storefront forgets it and
 *   sends the buyer to the order.
 * - `cart_completion_incomplete` (409) and `cart_completion_check_failed`
 *   (409): nothing was placed. The message says so and asks the buyer to try
 *   again, which needs the cart, so the storefront keeps it.
 *
 * Pure TS with no imports, so a test can hold it without a Next runtime.
 */

export const CART_ALREADY_COMPLETED = "cart_already_completed"
export const CART_COMPLETION_INCOMPLETE = "cart_completion_incomplete"
export const CART_COMPLETION_CHECK_FAILED = "cart_completion_check_failed"

/**
 * The backend's `cart_already_completed` message sends the buyer to "Orders
 * in your account", which a guest does not have. Shown instead to a buyer
 * who is not signed in, when the answer names no order to send them to.
 */
export const ALREADY_PLACED_GUEST_MESSAGE =
  "Your order for this cart has already been placed. Your order confirmation email has the details."

/**
 * Where a buyer whose cart is already an order is sent: the order's
 * confirmation page, for a guest and a signed-in buyer alike. The account's
 * order page cannot show it: it is keyed by Mercur's order set
 * (`/user/orders/[id]` reads `/store/order-set/:id`), and an order Medusa's
 * own completion placed has none.
 */
export const orderConfirmationPath = (orderId: string): string =>
  `/order/${encodeURIComponent(orderId)}/confirmed`
