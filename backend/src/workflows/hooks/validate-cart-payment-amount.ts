import { CartPaymentAmountError, type CartPaymentAmounts, judgeCartPaymentAmount } from "../../lib/cart-payment-amount"
import { createLogger } from "../../shared/logger"
import type { CompleteCartValidateArgs } from "./complete-cart-validate-args"

const log = createLogger("workflows/hooks/validate-cart-payment-amount")

/**
 * Refuse to complete a cart on a payment session that is not for the cart's
 * total (SD-115; the decision is `judgeCartPaymentAmount`,
 * `lib/cart-payment-amount.ts`).
 *
 * The middleware in front of Mercur's `POST /store/carts/:id/complete` makes
 * the same refusal for the main checkout. This is the one for everything that
 * completes through Medusa's `completeCartWorkflow`, none of which passes that
 * middleware: `POST /store/carts/:id/complete-tickets` and
 * `/complete-digital`, `POST /store/subscriptions`, `POST
 * /store/rentals/:cart_id`, the hosted checkout pages, subscription renewals,
 * and Medusa's payment webhook. Measured before this guard, with a publishable
 * key only and an ordinary cart: a cart totalling 19 with a pending session
 * for 15 completed through `complete-tickets`, through `complete-digital` and
 * through the workflow run directly, each time into an order of 19 on a
 * payment of 15.
 *
 * It judges the cart the workflow itself read (`completeCartFields` carry the
 * total, the currency and the sessions with their amounts). That one read is
 * what the workflow goes on to build the order from and to pick the session
 * it authorizes from, so the total compared here is the order's. It reads
 * nothing else, and nothing of the hawala ledger.
 *
 * It only refuses. It does not put the payment side right from here: the
 * workflow is still running, and where it holds the cart's lock Medusa's
 * refresh, which takes the same lock, would wait out its two seconds and
 * fail. The store routes do that after the workflow has ended
 * (`settleCartPaymentAfterRefusedCompletion`,
 * `api/middlewares/cart-payment-refresh.ts`); on the other paths the session
 * is left, and Medusa's own compensation for a failed completion tries to
 * refund a payment that was already captured.
 *
 * Closed on doubt: a run that hands the hook no cart is refused like one whose
 * amounts cannot be read. (Medusa's `validateCartPaymentsStep`, which runs
 * before the hook, has already failed on such a run.) A cart that has
 * completed never gets here: the composition skips every guard on a re-run.
 */
export async function validateCartPaymentAmount(args: CompleteCartValidateArgs): Promise<void> {
  const cartId = args?.input?.id ?? "?"
  const cart = args?.cart as (Partial<CartPaymentAmounts> & object) | null | undefined
  const verdict =
    cart && typeof cart === "object"
      ? judgeCartPaymentAmount({ ...cart, id: typeof cart.id === "string" ? cart.id : cartId })
      : ({ ok: false, reason: "amount_unknown", detail: `cart ${cartId}: the completion handed the guard no cart` } as const)
  if (verdict.ok) return

  log.error(`[cart-payment] completion refused inside completeCartWorkflow: ${verdict.detail}; no order is created`, {
    cart_id: cartId,
    reason: verdict.reason,
  })
  throw new CartPaymentAmountError(verdict.reason)
}
