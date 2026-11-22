/**
 * A cart that owes nothing: its total is zero or less (free items, a
 * promotion that covers everything).
 *
 * No payment session is opened for one. Medusa asks the provider for an intent
 * of whatever the amount is, and Stripe documents a minimum charge and refuses
 * an intent below it (by its documentation; the checkout specs stub Stripe),
 * so on such a cart the payment step could only answer "We could not start
 * the card payment", and the review step never offered Place order. Medusa's
 * manual provider used to be the one way through, and a production build no
 * longer offers it (lib/constants/payment-providers.ts).
 *
 * What the backend does with such a cart decides what the storefront offers:
 *
 * - The main checkout (`POST /store/carts/:id/complete`, Mercur's) cannot
 *   complete it: Mercur's workflow fails on a cart with no payment to
 *   authorize. The backend answers 409 `cart_nothing_to_pay`, "Your order was
 *   not placed: orders with nothing to pay can't be placed yet. You have not
 *   been charged." (`backend/src/api/middlewares/cart-completion-guards.ts`).
 *   So the storefront says so on the payment and review steps instead of
 *   leading the buyer to a button that can only be refused.
 * - The ticket checkout (`POST /store/carts/:id/complete-tickets`, Medusa's
 *   own completion) does complete it, with no payment collection and no
 *   session: measured on Postgres, with FF_TICKET_ORDER_SETTLEMENT_V1 on and
 *   off, 200 with the order (total 0, no payment), the seat sold, Stripe
 *   never called, and the same order again on a second request. So an
 *   all-ticket cart that owes nothing gets Place order, and needs no payment
 *   method.
 *
 * Pure TS with no imports.
 */

type CartTotal = { total?: unknown } | null | undefined
type CartLines = { items?: ReadonlyArray<{ metadata?: Record<string, unknown> | null } | null | undefined> | null } | null | undefined

/**
 * True when the cart's total is a number and is zero or less. A total that is
 * missing or not a number is not "nothing": the buyer is never told an order
 * owes nothing on a total that could not be read (the backend's rule too).
 */
export const cartOwesNothing = (cart: CartTotal): boolean => {
  const total = cart?.total
  if (total === null || total === undefined || total === "") return false
  const amount = Number(total)
  return Number.isFinite(amount) && amount <= 0
}

/**
 * Ticket lines carry seat metadata (stamped by the ticket purchase panel). A
 * cart completes through the ticket checkout only when it is entirely
 * tickets: a mixed cart sent there would put the other items (and other
 * sellers') through Medusa's completion, round the marketplace split. Mixed
 * carts are stopped at Place order.
 */
export const cartTicketMode = (cart: CartLines): "none" | "all-tickets" | "mixed" => {
  const items = cart?.items ?? []
  const ticketCount = items.filter((item) => !!item?.metadata?.show_date).length
  if (ticketCount === 0) return "none"
  return ticketCount === items.length ? "all-tickets" : "mixed"
}

/** A cart that owes nothing and can still be placed: every line a ticket. */
export const canPlaceWithoutPayment = (cart: CartTotal & CartLines): boolean =>
  cartOwesNothing(cart) && cartTicketMode(cart) === "all-tickets"

/** Shown on the payment and review steps for a cart that owes nothing and cannot be placed. The backend's sentence, without "was not placed": nothing was tried. */
export const NOTHING_TO_PAY_NOT_PLACEABLE =
  "This order has nothing to pay, and orders with nothing to pay can't be placed yet. You have not been charged."

/** Shown for an all-ticket cart that owes nothing. */
export const NOTHING_TO_PAY_NO_METHOD_NEEDED =
  "This order has nothing to pay, so no payment method is needed."

/**
 * Whether the steps before Place order are done, so the review step shows its
 * button: an address, a delivery option, and a payment collection (a method
 * chosen) unless the cart owes nothing, which has none to choose.
 */
export const reviewStepReached = (
  cart:
    | (CartTotal & {
        shipping_address?: unknown
        shipping_methods?: ReadonlyArray<unknown> | null
        payment_collection?: unknown
      })
    | null
    | undefined,
  paidByGiftcard = false
): boolean =>
  !!cart?.shipping_address &&
  (cart.shipping_methods?.length ?? 0) > 0 &&
  (!!cart.payment_collection || paidByGiftcard || cartOwesNothing(cart))
