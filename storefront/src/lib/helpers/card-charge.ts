/**
 * Whether confirming a card session charges the total the buyer is shown.
 *
 * Stripe is not asked for the cart's total. It is asked for the amount of the
 * PaymentIntent, and the backend fixed that when the payment session was
 * opened: the session's `amount`, copied from the cart's payment collection.
 * Medusa's own cart workflows keep the two together (a change of total
 * re-amounts the collection and deletes its sessions). A write that goes
 * round those workflows does not, and then the review step shows one total
 * while `confirmCardPayment` takes another. The backend's
 * `POST /store/carts/:id/tier` and `/wholesale` reprice line items that way.
 *
 * Compared in the currency's minor unit, because that is what both sides come
 * down to: Stripe is sent the session amount rounded to it, and the buyer
 * reads the total formatted to it.
 *
 * An amount that is not a number is a mismatch. A charge of unknown size is
 * not one to confirm.
 *
 * Pure TS with no imports, like lib/constants/payment-providers.ts:
 * `backend/integration-tests/http/storefront-payment-providers.spec.ts` runs
 * this file against a cart a booted backend serves.
 */

type SessionAmount = { amount?: unknown } | null | undefined
type CartTotal = { total?: unknown; currency_code?: string | null } | null | undefined

/** Decimal places of a currency's minor unit: 2 for usd, 0 for jpy. */
export const minorUnitDigits = (currencyCode?: string | null): number => {
  if (!currencyCode) return 2
  try {
    const digits = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currencyCode,
    }).resolvedOptions().maximumFractionDigits
    return typeof digits === "number" ? digits : 2
  } catch {
    // Not a currency code Intl knows.
    return 2
  }
}

const isAmount = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value)

export const cardChargeMatchesCartTotal = (
  session: SessionAmount,
  cart: CartTotal
): boolean => {
  const charge = session?.amount
  const total = cart?.total
  if (!isAmount(charge) || !isAmount(total)) return false

  const factor = 10 ** minorUnitDigits(cart?.currency_code)
  return Math.round(charge * factor) === Math.round(total * factor)
}
