import { MathBN, MedusaError, PaymentSessionStatus, defaultCurrencies } from "@medusajs/framework/utils"

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
 *    settles the payment side afterwards (`lib/cart-payment-refresh.ts`,
 *    `api/middlewares/cart-payment-refresh.ts`): the collection takes the
 *    total, and a session opened for another amount is deleted;
 *  - and, because that can fail, a writer can be missed, and a session can be
 *    opened while a write is still on its way, a cart whose session is for
 *    another amount is refused at completion, on every path that completes
 *    one, before an order is created (`judgeCartPaymentAmount`, below; the
 *    middleware in front of Mercur's route, and
 *    `workflows/hooks/validate-cart-payment-amount.ts` inside Medusa's
 *    workflow).
 *
 * This file is the decision and its answers, with no workflow import, so a
 * unit spec can load it without booting anything.
 */

/** The `code` of a completion refused for its session's amount. Stable: clients and tests key on it. */
export const CART_PAYMENT_AMOUNT_MISMATCH = "cart_payment_amount_mismatch"

/**
 * 409, as an unfinished completion is answered (`lib/cart-completion.ts`):
 * the cart is in a state this request cannot act on.
 */
export const CART_PAYMENT_AMOUNT_MISMATCH_STATUS = 409

/**
 * What the buyer is told when a session that has taken nothing yet is for
 * another amount. Each sentence holds for every provider this backend
 * registers: the refusal comes before the completion authorizes anything, so
 * nothing new is taken; the storefront has already confirmed the card with
 * Stripe by then, which under manual capture (the Stripe provider's default,
 * and `medusa-config.ts` does not change it) is a hold and not a charge; and
 * the session is deleted after the refusal, which cancels the intent and with
 * it the hold (if that fails, the hold lapses on Stripe's side). A session an
 * earlier attempt authorized is the same case: a hold, released the same way.
 */
export const CART_PAYMENT_AMOUNT_MISMATCH_MESSAGE =
  "Your order total changed after you chose how to pay, so your order was not placed and your card was not charged. " +
  "If your card shows a pending authorization, it will be released. " +
  "Please choose your payment method again to pay the current total."

/**
 * What the buyer is told when the session for another amount has been
 * captured: money was taken, so "your card was not charged" would be untrue,
 * and choosing the payment method again would take a second payment. Nothing
 * here can give it back (a captured intent cannot be cancelled), so the
 * session is left as it is and the buyer is sent to a person. On the paths
 * through Medusa's `completeCartWorkflow` its own compensation tries the
 * refund when the hook refuses; that is not promised here because it can fail.
 */
export const CART_PAYMENT_AMOUNT_CAPTURED_MESSAGE =
  "Your order was not placed. A payment has already been taken for this cart, and it is not for the cart's current total. " +
  "Please contact support so the payment can be refunded or your order completed."

/**
 * What the buyer is told when the comparison could not be made at all (the
 * cart, its total, its currency or a session's amount could not be read).
 * Nothing is known about the total having changed, so nothing is said about
 * it; what is known is that the completion stopped here, before it authorized
 * anything.
 */
export const CART_PAYMENT_AMOUNT_UNCONFIRMED_MESSAGE =
  "We could not check your payment against your order total, so your order was not placed and this attempt did not charge your card. " +
  "Please try again."

/** The `code` of a cart write whose payment collection could not be refreshed afterwards. */
export const CART_PAYMENT_REFRESH_FAILED = "cart_payment_refresh_failed"

/** 500: the write went through and FBM then failed at its own follow-up. Not the caller's doing. */
export const CART_PAYMENT_REFRESH_FAILED_STATUS = 500

/**
 * What the buyer is told when the cart changed and its payment could not be
 * brought up to date. The change is not undone (the route that made it has
 * finished).
 *
 * It does not say to try again, because for most of the routes that answer
 * this, repeating the request never reaches the refresh: Mercur refuses the
 * same delivery option a second time as "doubled" before it writes
 * (`POST .../shipping-methods`, pinned in
 * `integration-tests/http/cart-payment-refresh.spec.ts`), and a repeated
 * removal names shipping methods or a line that are already gone (`DELETE
 * .../shipping-methods`, `DELETE .../line-items/:line_id`). Only the tier,
 * wholesale and taxes routes end in the refresh again on a repeat. What puts
 * every one of them right is the completion check: a session left for
 * another amount is refused on every path that completes a cart, a refusal
 * on a store route then brings the cart's payment to its total, and the
 * buyer chooses the payment method again (the storefront's "Update payment"
 * does both halves in one step). So the message says that, which holds
 * whichever route sent it.
 */
export const CART_PAYMENT_REFRESH_FAILED_MESSAGE =
  "Your cart was updated, but we could not update its payment for the new total. " +
  "Your payment is checked against the new total before your order is placed, and you may be asked to choose your payment method again."

/** The `code` of a tier or wholesale reprice asked of a cart that has already completed. */
export const CART_ALREADY_COMPLETED = "cart_already_completed"

/**
 * 400 `invalid_data`, which is how Medusa's own cart writes answer a completed
 * cart (`validateCartStep`: "Cart ... is already completed."), so a client
 * meets one status for it whichever route it called.
 */
export const CART_ALREADY_COMPLETED_STATUS = 400

/** What the caller is told. An order's prices are the order's; the cart that made it is not repriced. */
export const CART_ALREADY_COMPLETED_MESSAGE = "This cart has already been checked out, so its prices can no longer be changed."

export type CartPaymentRefusalBody<Code extends string> = { code: Code; type: Code; message: string }

export type CartPaymentAmountRefusalReason =
  /** A session that has captured nothing is for an amount that is not the cart's total. */
  | "session_amount_mismatch"
  /** A captured session is for an amount that is not the cart's total. */
  | "captured_amount_mismatch"
  /** The cart's total, its currency or a session's amount could not be read as a number of minor units. */
  | "amount_unknown"

const REFUSAL_MESSAGES: Record<CartPaymentAmountRefusalReason, string> = {
  session_amount_mismatch: CART_PAYMENT_AMOUNT_MISMATCH_MESSAGE,
  captured_amount_mismatch: CART_PAYMENT_AMOUNT_CAPTURED_MESSAGE,
  amount_unknown: CART_PAYMENT_AMOUNT_UNCONFIRMED_MESSAGE,
}

const isRefusalReason = (value: unknown): value is CartPaymentAmountRefusalReason =>
  typeof value === "string" && Object.prototype.hasOwnProperty.call(REFUSAL_MESSAGES, value)

/** What the buyer is told for each reason a completion is refused. */
export const cartPaymentAmountRefusalMessage = (reason: CartPaymentAmountRefusalReason): string => REFUSAL_MESSAGES[reason]

/**
 * The HTTP answer to a completion refused for its session's amount: one
 * status and one code whatever the reason, and the message that is true for
 * that reason. No ids: the buyer has the cart; support has the log.
 */
export const cartPaymentAmountMismatchResponse = (
  reason: CartPaymentAmountRefusalReason = "session_amount_mismatch"
): {
  status: typeof CART_PAYMENT_AMOUNT_MISMATCH_STATUS
  body: CartPaymentRefusalBody<typeof CART_PAYMENT_AMOUNT_MISMATCH>
} => ({
  status: CART_PAYMENT_AMOUNT_MISMATCH_STATUS,
  body: {
    code: CART_PAYMENT_AMOUNT_MISMATCH,
    type: CART_PAYMENT_AMOUNT_MISMATCH,
    message: cartPaymentAmountRefusalMessage(reason),
  },
})

/**
 * The refusal as an error, for where the decision is made inside a workflow
 * (`workflows/hooks/validate-cart-payment-amount.ts`). `not_allowed`, so that
 * a caller that knows nothing of it still answers 400 with the buyer's
 * message; the HTTP error handler knows it by its code and answers as
 * `cartPaymentAmountMismatchResponse` does (`shared/error-sanitizer.ts`).
 */
export class CartPaymentAmountError extends MedusaError {
  readonly reason: CartPaymentAmountRefusalReason

  constructor(reason: CartPaymentAmountRefusalReason) {
    super(MedusaError.Types.NOT_ALLOWED, cartPaymentAmountRefusalMessage(reason), CART_PAYMENT_AMOUNT_MISMATCH)
    this.reason = reason
  }
}

/** An error that crossed a workflow boundary may be a plain object; the code is what it keeps. */
export type CartPaymentAmountRefusalLike = { code: typeof CART_PAYMENT_AMOUNT_MISMATCH; reason?: unknown; message?: unknown }

export function isCartPaymentAmountRefusal(error: unknown): error is CartPaymentAmountRefusalLike {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === CART_PAYMENT_AMOUNT_MISMATCH
}

/**
 * The HTTP answer to that error. The message is one of ours or it is not
 * sent: the reason picks it, or else the error's own message when it is one
 * of the three, or else the one that claims least. It reads only those two
 * fields, so it takes the error as thrown (`CartPaymentAmountError`) or as it
 * arrives after crossing a workflow boundary.
 */
export function cartPaymentAmountRefusalResponse(error: {
  code?: unknown
  reason?: unknown
  message?: unknown
}): ReturnType<typeof cartPaymentAmountMismatchResponse> {
  if (isRefusalReason(error.reason)) return cartPaymentAmountMismatchResponse(error.reason)
  const known = (Object.keys(REFUSAL_MESSAGES) as CartPaymentAmountRefusalReason[]).find((reason) => REFUSAL_MESSAGES[reason] === error.message)
  return cartPaymentAmountMismatchResponse(known ?? "amount_unknown")
}

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

/** The HTTP answer to a reprice asked of a completed cart. */
export const cartAlreadyCompletedResponse = (): {
  status: typeof CART_ALREADY_COMPLETED_STATUS
  body: { code: typeof CART_ALREADY_COMPLETED; type: "invalid_data"; message: string }
} => ({
  status: CART_ALREADY_COMPLETED_STATUS,
  body: {
    code: CART_ALREADY_COMPLETED,
    type: "invalid_data",
    message: CART_ALREADY_COMPLETED_MESSAGE,
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
 * The sessions a completion pays with: every status `validateCartPaymentsStep`
 * lets through. Mercur's split and Medusa's workflow take the first of these
 * and record their orders on its payment at the cart's total, whether this
 * completion authorizes it or an earlier attempt already did, so one that was
 * authorized or captured for another amount is as wrong as a pending one
 * (measured: a session authorized at 32 on a cart since repriced to 36
 * completed into orders of 15 and 21 on one payment of 32).
 */
const PAID_WITH: ReadonlySet<string> = new Set<string>([
  PaymentSessionStatus.PENDING,
  PaymentSessionStatus.REQUIRES_MORE,
  PaymentSessionStatus.AUTHORIZED,
  PaymentSessionStatus.CAPTURED,
])

type Session = { id?: string | null; amount?: unknown; status?: string | null }

/** A payment on the cart's collection, as far as `paymentsLeftWithoutSession` reads it. */
type Payment = { id?: string | null; payment_session_id?: string | null; captured_at?: unknown; canceled_at?: unknown }

/** A cart as far as the decision reads it. */
export type CartPaymentAmounts = {
  id: string
  completed_at?: unknown
  total?: unknown
  currency_code?: unknown
  payment_collection?: {
    payment_sessions?: Array<Session | null> | null
    payments?: Array<Payment | null> | null
  } | null
}

export type CartPaymentAmountVerdict =
  | { ok: true }
  | { ok: false; reason: CartPaymentAmountRefusalReason; detail: string }

type Comparison =
  /** Nothing is owed a comparison: completed, no session to pay with, or nothing to pay. */
  | { kind: "nothing" }
  /** A comparison is owed and the cart's own side of it cannot be read. */
  | { kind: "unknown"; detail: string }
  | {
      kind: "compared"
      total: number
      rows: Array<{ session: Session; amount: number | null; matches: boolean }>
    }

function compare(cart: CartPaymentAmounts): Comparison {
  if (cart.completed_at) return { kind: "nothing" }

  const sessions = (cart.payment_collection?.payment_sessions ?? []).filter(
    (session): session is Session => !!session && PAID_WITH.has(String(session.status ?? ""))
  )
  if (!sessions.length) return { kind: "nothing" }

  const digits = minorUnitDigits(cart.currency_code)
  if (digits === null) {
    return { kind: "unknown", detail: `cart ${cart.id}: currency ${JSON.stringify(cart.currency_code ?? null)} has no known minor unit` }
  }
  const total = toMinorUnits(cart.total, digits)
  if (total === null) return { kind: "unknown", detail: `cart ${cart.id}: its total could not be read as a number` }
  if (total <= 0) return { kind: "nothing" }

  return {
    kind: "compared",
    total,
    rows: sessions.map((session) => {
      const amount = toMinorUnits(session.amount, digits)
      return { session, amount, matches: amount !== null && amount === total }
    }),
  }
}

/**
 * Whether a cart may go on to completion as far as its payment sessions'
 * amounts go.
 *
 * Refused: a session the completion would pay with whose amount, in the
 * currency's minor unit, is not the cart's total. Refused as well when that
 * comparison is owed and cannot be made (no numeric total, a currency
 * Medusa's table does not have, a session with no numeric amount): a charge
 * of unknown size is not one to authorize. The reason says which, and which
 * message is true: a captured session for another amount comes first (money
 * was taken), then any other session for another amount, then an amount that
 * could not be read.
 *
 * Passed on, for the completion to answer as it always has:
 *  - a cart that has completed (a replay; nothing is authorized again, and
 *    refusing would hide the order it made);
 *  - a cart with no session to pay with (the completion refuses it itself, or
 *    it owes nothing);
 *  - a cart that owes nothing: `validateCartPaymentsStep` skips payment at a
 *    total of zero or less, so no session is used whatever it holds.
 *
 * Coalition Credits do not come into it. A reservation is cart metadata and a
 * ledger entry; it changes neither the cart's total nor a session's amount
 * (`lib/ccr-checkout.ts`: credits are tender whose payment half is not built),
 * so a cart holding one is compared like any other, and this reads nothing of
 * the ledger.
 */
export function judgeCartPaymentAmount(cart: CartPaymentAmounts): CartPaymentAmountVerdict {
  const comparison = compare(cart)
  if (comparison.kind === "nothing") return { ok: true }
  if (comparison.kind === "unknown") return { ok: false, reason: "amount_unknown", detail: comparison.detail }

  const { total } = comparison
  const wrong = comparison.rows.filter((row) => !row.matches)
  if (!wrong.length) return { ok: true }

  const describe = (row: (typeof wrong)[number]) =>
    `cart ${cart.id}: ${row.session.status} session ${row.session.id ?? "?"} is for ${row.amount} and the cart's total is ${total} (minor units, ${String(cart.currency_code)})`

  const captured = wrong.find((row) => row.amount !== null && row.session.status === PaymentSessionStatus.CAPTURED)
  if (captured) return { ok: false, reason: "captured_amount_mismatch", detail: describe(captured) }
  const other = wrong.find((row) => row.amount !== null)
  if (other) return { ok: false, reason: "session_amount_mismatch", detail: describe(other) }
  return {
    ok: false,
    reason: "amount_unknown",
    detail: `cart ${cart.id}: ${wrong[0].session.status} session ${wrong[0].session.id ?? "?"} has no numeric amount`,
  }
}

/**
 * The sessions to delete so that the next one opened is the only one, and is
 * for the cart's total: every session a completion would pay with that is not
 * for the total (or whose amount cannot be read) and has captured nothing.
 *
 * A captured session is never in the list. Deleting a session cancels its
 * intent, a captured intent cannot be cancelled, and the money it took needs
 * a refund, which is not a cart write's to give; the completion refuses it
 * (`captured_amount_mismatch`) and it is left for a person.
 *
 * Empty when nothing is owed a comparison, and when the cart's own side
 * cannot be read: with no total to hold a session to, none is deleted.
 */
export function sessionsNotForCartTotal(cart: CartPaymentAmounts): string[] {
  const comparison = compare(cart)
  if (comparison.kind !== "compared") return []
  return comparison.rows
    .filter((row) => !row.matches && row.session.status !== PaymentSessionStatus.CAPTURED)
    .map((row) => row.session.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0)
}

const isId = (value: unknown): value is string => typeof value === "string" && value.length > 0

/**
 * The payments on a cart's collection that no completion can use any more
 * and that a capture would still pick: each captured nothing and its payment
 * session is gone. `canceled` says whether Medusa already marked it
 * cancelled.
 *
 * How one is made: authorizing a session creates a Payment row beside it,
 * and deleting the session (Medusa's `deletePaymentSession`, which every
 * refresh, `deletePaymentSessionsWorkflow` and a new session opened on the
 * collection use) cancels the intent with the provider and deletes the
 * session row only. Nothing ties the payment to its session in the database
 * (`payment.payment_session_id` has no foreign key), so the payment stays on
 * the collection, live, for an intent that is cancelled. Medusa's own
 * compensation for a completion that failed after it authorized leaves one
 * too, cancelled, once the buyer's next session replaces the old one.
 *
 * A capture then takes it. Mercur's `order-set-placed-payment-capture`
 * captures the collection's first payment whatever its state (measured in
 * review: after a session authorized at 32 was deleted and the cart paid at
 * 36, it captured the cancelled 32 intent and left the 36 payment
 * uncaptured), and FBM's capture selection for its single-order checkouts
 * counts an uncancelled one as a second candidate and refuses every retry
 * ("2 uncaptured payments"). So such a payment is cancelled and taken off
 * the collection (`retireOrphanedPayments`, `lib/cart-payment-refresh.ts`).
 *
 * Never on a completed cart (its payments are its order's) and never a
 * payment that captured anything. Empty when the cart's sessions were not
 * read: with no list of the sessions that remain, every payment would look
 * orphaned, and none may be taken for that.
 */
export function paymentsLeftWithoutSession(cart: CartPaymentAmounts): Array<{ id: string; canceled: boolean }> {
  if (cart.completed_at) return []
  const sessions = cart.payment_collection?.payment_sessions
  const payments = cart.payment_collection?.payments
  if (!Array.isArray(sessions) || !Array.isArray(payments)) return []
  const remaining = new Set(sessions.map((session) => session?.id).filter(isId))
  return payments
    .filter(
      (payment): payment is Payment & { id: string; payment_session_id: string } =>
        !!payment &&
        isId(payment.id) &&
        !payment.captured_at &&
        isId(payment.payment_session_id) &&
        !remaining.has(payment.payment_session_id)
    )
    .map((payment) => ({ id: payment.id, canceled: !!payment.canceled_at }))
}
