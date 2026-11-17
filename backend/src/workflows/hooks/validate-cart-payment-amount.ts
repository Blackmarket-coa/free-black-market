import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  CartPaymentAmountError,
  type CartPaymentAmounts,
  type CartPaymentAmountVerdict,
  judgeCartPaymentAmount,
} from "../../lib/cart-payment-amount"
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
 * The cart the workflow read has the sessions and not the collection's
 * payments, and a session's status does not say whether its payment
 * captured: Medusa stores a session captured at authorization as
 * `authorized` (`judgeCartPaymentAmount`). So when a session is for another
 * amount, the payments are read before the answer is chosen, and one that
 * captured gets the message that does not say the card was not charged. When
 * that read fails it is not known whether money was taken, so the refusal is
 * the one that claims least (`amount_unknown`). A cart that passes is never
 * read again.
 *
 * Closed on doubt: a run that hands the hook no cart is refused like one whose
 * amounts cannot be read. (Medusa's `validateCartPaymentsStep`, which runs
 * before the hook, has already failed on such a run.) A cart that has
 * completed never gets here: the composition skips every guard on a re-run.
 */
export async function validateCartPaymentAmount(
  args: CompleteCartValidateArgs,
  context?: { container?: { resolve: (key: string) => unknown } }
): Promise<void> {
  const cartId = args?.input?.id ?? "?"
  const cart = args?.cart as (Partial<CartPaymentAmounts> & object) | null | undefined
  let verdict: CartPaymentAmountVerdict =
    cart && typeof cart === "object"
      ? judgeCartPaymentAmount({ ...cart, id: typeof cart.id === "string" ? cart.id : cartId })
      : ({ ok: false, reason: "amount_unknown", detail: `cart ${cartId}: the completion handed the guard no cart` } as const)
  if (!verdict.ok && verdict.reason === "session_amount_mismatch" && cart && typeof cart === "object") {
    verdict = await judgedWithPayments({ ...cart, id: typeof cart.id === "string" ? cart.id : cartId }, context)
  }
  if (verdict.ok) return

  log.error(`[cart-payment] completion refused inside completeCartWorkflow: ${verdict.detail}; no order is created`, {
    cart_id: cartId,
    reason: verdict.reason,
  })
  throw new CartPaymentAmountError(verdict.reason)
}

type QueryLike = {
  graph: (args: { entity: string; fields: string[]; filters: Record<string, unknown> }) => Promise<{ data: unknown[] }>
}

/**
 * The verdict again, with the collection's payments read, so that a session
 * whose payment captured is judged as captured. The payment's own session
 * column is read, not the session through it.
 */
async function judgedWithPayments(
  cart: CartPaymentAmounts,
  context?: { container?: { resolve: (key: string) => unknown } }
): Promise<CartPaymentAmountVerdict> {
  const collectionId = (cart.payment_collection as { id?: unknown } | null | undefined)?.id
  try {
    if (typeof collectionId !== "string" || !collectionId) throw new Error("the cart's payment collection has no id")
    const container = context?.container
    if (!container) throw new Error("the hook was given no container")
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as QueryLike
    const { data } = await query.graph({
      entity: "payment",
      fields: ["id", "payment_session_id", "captured_at", "canceled_at"],
      filters: { payment_collection_id: collectionId },
    })
    return judgeCartPaymentAmount({
      ...cart,
      payment_collection: { ...cart.payment_collection, payments: data as NonNullable<CartPaymentAmounts["payment_collection"]>["payments"] },
    })
  } catch (error) {
    return {
      ok: false,
      reason: "amount_unknown",
      detail: `cart ${cart.id}: a session is for another amount, and whether its payment captured could not be read: ${(error as Error)?.message ?? error}`,
    }
  }
}
