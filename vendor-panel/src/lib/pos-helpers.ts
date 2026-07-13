import { castNumber } from "./cast-number"
import { getDecimalDigits } from "./money-amount-helpers"

/**
 * Pure helpers for the POS ring-up form. The vendor API and all vendor-panel
 * price inputs work in MAJOR units (decimal), but `POST /vendor/pos/orders`
 * expects `unit_price` in MINOR units — converted per-currency (JPY has 0
 * decimals, some currencies have 3), never a hardcoded *100.
 */

export type PosLine = {
  /** Catalog variant, when the line was picked from the product search. */
  variant_id?: string
  /** Display / ad-hoc title. Required when there is no variant. */
  title: string
  quantity: number | string
  /** MAJOR units, as typed (may be "12,50" style — castNumber handles it). */
  unit_price: number | string
}

export type PosOrderOptions = {
  currencyCode: string
  paymentMethod: string
  note?: string
  email?: string
}

export type PosOrderPayload = {
  items: Array<{
    variant_id?: string
    title?: string
    quantity: number
    unit_price: number
  }>
  currency_code: string
  payment_method: string
  note?: string
  email?: string
}

export type BuildPosOrderResult =
  | { ok: true; payload: PosOrderPayload }
  | { ok: false; message: string }

/** Convert a major-unit amount to minor units for the given currency. */
export const toMinorUnits = (
  amount: number | string,
  currencyCode: string
): number => {
  const major = castNumber(amount)
  return Math.round(major * 10 ** getDecimalDigits(currencyCode))
}

/** Running total of the lines, in MAJOR units (for display). */
export const posLinesTotal = (lines: PosLine[]): number => {
  return lines.reduce((sum, line) => {
    const price = castNumber(line.unit_price)
    const qty = castNumber(line.quantity)
    if (!Number.isFinite(price) || !Number.isFinite(qty)) {
      return sum
    }
    return sum + price * qty
  }, 0)
}

/**
 * Validate the ring-up lines and build the `POST /vendor/pos/orders` body.
 */
export const buildPosOrderPayload = (
  lines: PosLine[],
  options: PosOrderOptions
): BuildPosOrderResult => {
  if (lines.length === 0) {
    return { ok: false, message: "Add at least one item" }
  }

  const items: PosOrderPayload["items"] = []
  for (const [index, line] of lines.entries()) {
    const title = line.title.trim()
    if (!line.variant_id && !title) {
      return { ok: false, message: `Item ${index + 1} needs a title` }
    }

    const quantity = Math.trunc(castNumber(line.quantity))
    if (!Number.isFinite(quantity) || quantity < 1) {
      return {
        ok: false,
        message: `Item ${index + 1} needs a quantity of 1 or more`,
      }
    }

    const priceMajor = castNumber(line.unit_price)
    if (!Number.isFinite(priceMajor) || priceMajor < 0) {
      return { ok: false, message: `Item ${index + 1} needs a valid price` }
    }

    items.push({
      ...(line.variant_id ? { variant_id: line.variant_id } : {}),
      ...(title ? { title } : {}),
      quantity,
      unit_price: toMinorUnits(priceMajor, options.currencyCode),
    })
  }

  return {
    ok: true,
    payload: {
      items,
      currency_code: options.currencyCode.toLowerCase(),
      payment_method: options.paymentMethod,
      ...(options.note?.trim() ? { note: options.note.trim() } : {}),
      ...(options.email?.trim() ? { email: options.email.trim() } : {}),
    },
  }
}
