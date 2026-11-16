import { MathBN, PaymentSessionStatus, defaultCurrencies } from "@medusajs/framework/utils"

/**
 * A card is charged what its payment session was opened for, not what the
 * cart totals when it completes (SD-115).
 *
 * Medusa opens a session for the amount of the cart's payment collection
 * (`createPaymentSessionsWorkflow`), and authorizing a session asks the
 * provider for the session's own amount. Nothing on the way to an order
 * compares that amount with the cart: Mercur's `split-and-complete-cart`
 * (FBM's main checkout) takes the first session `validateCartPaymentsStep`
 * hands it and authorizes it, then records each seller's order at the order's
 * own total; Medusa's `completeCartWorkflow` does the same with its one
 * order. Read in `@mercurjs/b2c-core` 1.5.0 and `@medusajs/core-flows` 2.14.2.
 *
 * So the two are kept together at both ends:
 *
 *  - every writer of a cart's total outside Medusa's own cart workflows
 *    refreshes the collection afterwards (`lib/cart-payment-refresh.ts`,
 *    `api/middlewares/cart-payment-refresh.ts`), which re-amounts it and
 *    deletes the sessions opened for the old amount;
 *  - and, because a refresh can fail and a writer can be missed, a cart whose
 *    session is for another amount is refused at completion, before anything
 *    is authorized (`judgeCartPaymentAmount`, below).
 *
 * This file is the decision and the two answers, with no workflow import, so
 * a unit spec can load it without booting anything.
 */

/** The `code` of a completion refused for its session's amount. Stable: clients and tests key on it. */
export const CART_PAYMENT_AMOUNT_MISMATCH = "cart_payment_amount_mismatch"

/**
 * 409, as an unfinished completion is answered (`lib/cart-completion.ts`):
 * the cart is in a state this request cannot act on.
 */
export const CART_PAYMENT_AMOUNT_MISMATCH_STATUS = 409

/**
 * What the buyer is told. Each sentence holds for every provider this backend
 * registers: the refusal comes before Mercur authorizes the session, so
 * nothing new is taken; the storefront has already confirmed the card with
 * Stripe by then, which under manual capture (the Stripe provider's default,
 * and `medusa-config.ts` does not change it) is a hold and not a charge; and
 * the refusal deletes the session, which cancels the intent and with it the
 * hold (if that fails, the hold lapses on Stripe's side).
 */
export const CART_PAYMENT_AMOUNT_MISMATCH_MESSAGE =
  "Your order total changed after you chose how to pay, so your order was not placed and your card was not charged. " +
  "If your card shows a pending authorization, it will be released. " +
  "Please choose your payment method again to pay the current total."

/** The `code` of a cart write whose payment collection could not be refreshed afterwards. */
export const CART_PAYMENT_REFRESH_FAILED = "cart_payment_refresh_failed"

/** 500: the write went through and FBM then failed at its own follow-up. Not the caller's doing. */
export const CART_PAYMENT_REFRESH_FAILED_STATUS = 500

/**
 * What the buyer is told when the cart changed and its payment could not be
 * brought up to date. The change is not undone (the route that made it has
 * finished), and repeating the request is the cure: each of these routes ends
 * in the same refresh.
 */
export const CART_PAYMENT_REFRESH_FAILED_MESSAGE =
  "Your cart was updated, but we could not update its payment for the new total. Please try again."

export type CartPaymentRefusalBody<Code extends string> = { code: Code; type: Code; message: string }

/** The HTTP answer to a completion refused for its session's amount. No ids: the buyer has the cart; support has the log. */
export const cartPaymentAmountMismatchResponse = (): {
  status: typeof CART_PAYMENT_AMOUNT_MISMATCH_STATUS
  body: CartPaymentRefusalBody<typeof CART_PAYMENT_AMOUNT_MISMATCH>
} => ({
  status: CART_PAYMENT_AMOUNT_MISMATCH_STATUS,
  body: {
    code: CART_PAYMENT_AMOUNT_MISMATCH,
    type: CART_PAYMENT_AMOUNT_MISMATCH,
    message: CART_PAYMENT_AMOUNT_MISMATCH_MESSAGE,
  },
})

/** The HTTP answer to a cart write whose payment collection could not be refreshed. */
export const cartPaymentRefreshFailedResponse = (): {
  status: typeof CART_PAYMENT_REFRESH_FAILED_STATUS
  body: CartPaymentRefusalBody<typeof CART_PAYMENT_REFRESH_FAILED>
} => ({
  status: CART_PAYMENT_REFRESH_FAILED_STATUS,
  body: {
    code: CART_PAYMENT_REFRESH_FAILED,
    type: CART_PAYMENT_REFRESH_FAILED,
    message: CART_PAYMENT_REFRESH_FAILED_MESSAGE,
  },
})

/**
 * Decimal places of a currency's minor unit (2 for usd, 0 for jpy, 3 for
 * bhd), from the table Medusa seeds its currencies from; null for a code that
 * table does not have. Its keys are upper case.
 */
export function minorUnitDigits(currencyCode: unknown): number | null {
  if (typeof currencyCode !== "string" || !currencyCode) return null
  const currency = (defaultCurrencies as Record<string, { decimal_digits?: number } | undefined>)[currencyCode.toUpperCase()]
  const digits = currency?.decimal_digits
  return typeof digits === "number" && Number.isInteger(digits) && digits >= 0 ? digits : null
}

/** A money value as a finite number, or null. Medusa serves these as numbers; a string or a BigNumber is read too. */
function amountOf(value: unknown): number | null {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null
  try {
    const amount = typeof value === "number" ? value : MathBN.convert(value as Parameters<typeof MathBN.convert>[0]).toNumber()
    return Number.isFinite(amount) ? amount : null
  } catch {
    return null
  }
}

/**
 * An amount in the currency's minor unit, or null when it is not a number.
 * That unit is what both sides come down to: the provider is sent the session
 * amount rounded to it, and the buyer reads the total formatted to it.
 */
export function toMinorUnits(value: unknown, digits: number): number | null {
  const amount = amountOf(value)
  return amount === null ? null : Math.round(amount * 10 ** digits)
}

/**
 * The sessions a completion would newly take money on. `validateCartPaymentsStep`
 * also lets `authorized` and `captured` through, but those were authorized
 * already (by an earlier attempt at this completion, which a retry resumes),
 * and authorizing one again takes nothing.
 */
const UNAUTHORIZED: ReadonlySet<string> = new Set<string>([PaymentSessionStatus.PENDING, PaymentSessionStatus.REQUIRES_MORE])

/** A cart as far as the decision reads it. */
export type CartPaymentAmounts = {
  id: string
  completed_at?: unknown
  total?: unknown
  currency_code?: unknown
  payment_collection?: {
    payment_sessions?: Array<{ id?: string | null; amount?: unknown; status?: string | null } | null> | null
  } | null
}

export type CartPaymentAmountRefusalReason =
  /** A session is for an amount that is not the cart's total. */
  | "session_amount_mismatch"
  /** The cart's total, its currency or a session's amount could not be read as a number of minor units. */
  | "amount_unknown"

export type CartPaymentAmountVerdict =
  | { ok: true }
  | { ok: false; reason: CartPaymentAmountRefusalReason; detail: string }

/**
 * Whether a cart may go on to completion as far as its payment sessions'
 * amounts go.
 *
 * Refused: a session not yet authorized whose amount, in the currency's minor
 * unit, is not the cart's total. Refused as well when that comparison is owed
 * and cannot be made (no numeric total, a currency Medusa's table does not
 * have, a session with no numeric amount): a charge of unknown size is not
 * one to authorize.
 *
 * Passed on, for the completion route to answer as it always has:
 *  - a cart that has completed (a replay; nothing is authorized again, and
 *    refusing would hide the order it made);
 *  - a cart with no session to authorize (the route refuses it itself, or it
 *    owes nothing);
 *  - a cart that owes nothing: `validateCartPaymentsStep` skips payment at a
 *    total of zero or less, so no session is authorized whatever it holds.
 *
 * Coalition Credits do not come into it. A reservation is cart metadata and a
 * ledger entry; it changes neither the cart's total nor a session's amount
 * (`lib/ccr-checkout.ts`: credits are tender whose payment half is not built),
 * so a cart holding one is compared like any other, and this reads nothing of
 * the ledger.
 */
export function judgeCartPaymentAmount(cart: CartPaymentAmounts): CartPaymentAmountVerdict {
  if (cart.completed_at) return { ok: true }

  const sessions = (cart.payment_collection?.payment_sessions ?? []).filter(
    (session): session is NonNullable<typeof session> => !!session && UNAUTHORIZED.has(String(session.status ?? ""))
  )
  if (!sessions.length) return { ok: true }

  const digits = minorUnitDigits(cart.currency_code)
  if (digits === null) {
    return {
      ok: false,
      reason: "amount_unknown",
      detail: `cart ${cart.id}: currency ${JSON.stringify(cart.currency_code ?? null)} has no known minor unit`,
    }
  }
  const total = toMinorUnits(cart.total, digits)
  if (total === null) {
    return { ok: false, reason: "amount_unknown", detail: `cart ${cart.id}: its total could not be read as a number` }
  }
  if (total <= 0) return { ok: true }

  for (const session of sessions) {
    const amount = toMinorUnits(session.amount, digits)
    if (amount === null) {
      return {
        ok: false,
        reason: "amount_unknown",
        detail: `cart ${cart.id}: ${session.status} session ${session.id ?? "?"} has no numeric amount`,
      }
    }
    if (amount !== total) {
      return {
        ok: false,
        reason: "session_amount_mismatch",
        detail: `cart ${cart.id}: ${session.status} session ${session.id ?? "?"} is for ${amount} and the cart's total is ${total} (minor units, ${String(cart.currency_code)})`,
      }
    }
  }
  return { ok: true }
}
