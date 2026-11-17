/**
 * Medusa amounts as integer minor units.
 *
 * Medusa v2 keeps money in MAJOR units: an order subtotal of 25 is $25.00,
 * usually handed back as a BigNumber (which `Number()` reads through its
 * `valueOf`). Columns FBM declares as cents or minor units must be converted
 * on the way in, exactly once. Two stores got this wrong the same way: the
 * dispute intake (a $25.99 claim stored as 25) and creator attribution
 * (SD-95: a $25 order at 10% stored a commission of 2 cents, not 250).
 */

/**
 * Digits in a currency's minor unit: 2 for USD, 0 for JPY, 3 for KWD.
 *
 * Read from Intl, the same lookup the admin panel's Disputes screen formats
 * with (`admin-panel/src/routes/disputes/dispute-rules.ts`, `minorDigits`),
 * so a figure stored here reads back there as the amount that was meant. A
 * missing or unknown code counts as two digits.
 */
export function currencyMinorDigits(currencyCode: string | null | undefined): number {
  try {
    return (
      new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: String(currencyCode ?? "usd").toUpperCase(),
      }).resolvedOptions().maximumFractionDigits ?? 2
    )
  } catch {
    return 2
  }
}

/**
 * A Medusa amount as an integer in the currency's minor unit.
 *
 * Rounded to the nearest minor unit; the `toFixed` step drops binary noise
 * first, so 25.99 × 100 (2598.9999999999995) is 2599 and a half-cent from
 * tax rounds up rather than down. Anything unreadable is 0, which every
 * caller treats as "nothing to count".
 */
export function toMinorUnits(amount: unknown, currencyCode: string | null | undefined): number {
  const major = Number(amount)
  if (!Number.isFinite(major)) return 0
  const scaled = major * 10 ** currencyMinorDigits(currencyCode)
  return Math.round(Number(scaled.toFixed(6)))
}

/**
 * The inverse: an integer in the currency's minor unit as a Medusa amount.
 *
 * For an API that takes cents and hands them to Medusa, which wants major
 * units: `POST /v1/seller/launches` took `price: 1200` for $12.00 and
 * created the variant price as 1200, a $1,200.00 product. 1200 USD is 12,
 * 1200 JPY is 1200, 12345 KWD is 12.345. The result is rounded to the
 * currency's minor unit, so a fractional input cannot price below a cent.
 * Anything unreadable is NaN, for the caller to refuse; it is never priced
 * as 0.
 */
export function fromMinorUnits(minor: unknown, currencyCode: string | null | undefined): number {
  const value = Number(minor)
  if (!Number.isFinite(value)) return Number.NaN
  const digits = currencyMinorDigits(currencyCode)
  return Number((value / 10 ** digits).toFixed(digits))
}

/**
 * The mark a row written in minor units since its store's fix carries:
 * `metadata.amount_unit = "minor"`. Set by `OrderDisputeService.open` and by
 * `subscribers/attribute-order-on-placed.ts`.
 *
 * An old row and a new one can hold the same figures, so the corrective
 * scripts (`order-dispute/minor-unit-correction.ts`,
 * `creator-attribution/minor-unit-correction.ts`) never touch a marked row.
 */
export const AMOUNT_UNIT_METADATA_KEY = "amount_unit"
export const AMOUNT_UNIT_MINOR = "minor"

export function isMarkedMinorUnits(metadata: unknown): boolean {
  return (
    !!metadata &&
    typeof metadata === "object" &&
    (metadata as Record<string, unknown>)[AMOUNT_UNIT_METADATA_KEY] === AMOUNT_UNIT_MINOR
  )
}
