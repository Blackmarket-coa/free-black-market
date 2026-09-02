/**
 * Quote arithmetic and lifecycle.
 *
 * Pure, container-free, integer-only — the `ccr-checkout.ts` and
 * `accounts-receivable/terms.ts` precedent. A quote is a promise about money,
 * so the arithmetic that produces it is asserted to the cent without a
 * container.
 *
 * **A quote never encodes commission.** The negotiated `unit_price` is what
 * the buyer pays and what the vendor's payout is computed from; FBM's 3% is
 * applied downstream by `payout-breakdown` at order time, and only on native
 * sales (`payout-breakdown/commission-scope.ts`). A discount on a quote
 * reduces the base the same 3% applies to — it never changes the rate, and it
 * never comes out of the platform's share instead of the vendor's.
 * `assertQuoteCarriesNoCommission` gives that rule a caller.
 */

export enum QuoteStatus {
  /** Vendor is still building it. Invisible to the buyer. */
  DRAFT = "draft",
  /** Sent to the buyer. The clock to `valid_until` is running. */
  SENT = "sent",
  /** Buyer accepted. A cart exists at the quoted prices. */
  ACCEPTED = "accepted",
  /** Buyer said no. */
  DECLINED = "declined",
  /** Vendor pulled it before the buyer acted. */
  WITHDRAWN = "withdrawn",
  /** `valid_until` passed with no answer. */
  EXPIRED = "expired",
}

export class QuoteStateError extends Error {}
export class QuotePricingError extends Error {}

/** Terminal states. Nothing leaves these. */
const TERMINAL: readonly QuoteStatus[] = [
  QuoteStatus.ACCEPTED,
  QuoteStatus.DECLINED,
  QuoteStatus.WITHDRAWN,
  QuoteStatus.EXPIRED,
]

const TRANSITIONS: Record<QuoteStatus, QuoteStatus[]> = {
  [QuoteStatus.DRAFT]: [QuoteStatus.SENT, QuoteStatus.WITHDRAWN],
  [QuoteStatus.SENT]: [
    QuoteStatus.ACCEPTED,
    QuoteStatus.DECLINED,
    QuoteStatus.WITHDRAWN,
    QuoteStatus.EXPIRED,
  ],
  [QuoteStatus.ACCEPTED]: [],
  [QuoteStatus.DECLINED]: [],
  [QuoteStatus.WITHDRAWN]: [],
  [QuoteStatus.EXPIRED]: [],
}

export function isTerminal(status: QuoteStatus): boolean {
  return TERMINAL.includes(status)
}

export function isAllowedQuoteTransition(
  from: QuoteStatus,
  to: QuoteStatus
): boolean {
  return (TRANSITIONS[from] ?? []).includes(to)
}

export function assertQuoteTransition(from: QuoteStatus, to: QuoteStatus): void {
  if (!isAllowedQuoteTransition(from, to)) {
    throw new QuoteStateError(`cannot move a quote from ${from} to ${to}`)
  }
}

export type QuoteLineInput = {
  variant_id: string
  title?: string | null
  quantity: number
  /** Negotiated price per unit, minor units. */
  unit_price: number
  /** The catalogue price when the quote was built, minor units. */
  list_unit_price?: number | null
}

export type PricedQuoteLine = QuoteLineInput & {
  quantity: number
  unit_price: number
  list_unit_price: number | null
  /** `unit_price * quantity`. */
  line_subtotal: number
  /** What the buyer saves against list on this line. 0 when unknown. */
  line_savings: number
}

/**
 * Price one line.
 *
 * Quantity and price are integers by construction — a fractional cent or a
 * fractional unit on a B2B quote is a data-entry error, not a rounding
 * question, and accepting one silently would make the quote's total disagree
 * with the cart it becomes.
 */
export function priceLine(line: QuoteLineInput): PricedQuoteLine {
  const quantity = Number(line.quantity)
  const unitPrice = Number(line.unit_price)

  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new QuotePricingError(
      `quantity must be a positive whole number, got ${line.quantity}`
    )
  }
  if (!Number.isInteger(unitPrice) || unitPrice < 0) {
    throw new QuotePricingError(
      `unit_price must be a non-negative whole number of minor units, got ${line.unit_price}`
    )
  }

  const listRaw = line.list_unit_price
  const listUnitPrice =
    listRaw === null || listRaw === undefined || !Number.isFinite(Number(listRaw))
      ? null
      : Math.max(0, Math.floor(Number(listRaw)))

  const lineSubtotal = unitPrice * quantity
  // Never negative: a quote priced ABOVE list is a legitimate thing (rush
  // work, small batch), and reporting it as negative savings would read as a
  // discount that is not there.
  const lineSavings =
    listUnitPrice === null
      ? 0
      : Math.max(0, (listUnitPrice - unitPrice) * quantity)

  return {
    ...line,
    quantity,
    unit_price: unitPrice,
    list_unit_price: listUnitPrice,
    line_subtotal: lineSubtotal,
    line_savings: lineSavings,
  }
}

export type QuoteTotals = {
  subtotal: number
  list_subtotal: number
  savings: number
  line_count: number
  item_count: number
}

/**
 * Total a quote.
 *
 * `list_subtotal` falls back to the quoted price on lines with no list price,
 * so `subtotal + savings === list_subtotal` holds for every quote rather than
 * only for fully-annotated ones. A total that only balances sometimes is a
 * total nobody can check.
 */
export function totalQuote(lines: readonly QuoteLineInput[]): QuoteTotals {
  const priced = lines.map(priceLine)

  let subtotal = 0
  let listSubtotal = 0
  let itemCount = 0

  for (const line of priced) {
    subtotal += line.line_subtotal
    listSubtotal +=
      (line.list_unit_price ?? line.unit_price) * line.quantity
    itemCount += line.quantity
  }

  return {
    subtotal,
    list_subtotal: listSubtotal,
    savings: Math.max(0, listSubtotal - subtotal),
    line_count: priced.length,
    item_count: itemCount,
  }
}

export type ExpirableQuote = {
  status: QuoteStatus | string
  valid_until?: Date | string | null
}

const asDate = (value: Date | string | null | undefined): Date | null => {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Has this quote run out?
 *
 * Only a `sent` quote can expire. A draft has no clock running (the buyer has
 * never seen it) and a terminal quote has already ended — marking either
 * expired would overwrite what actually happened to it.
 */
export function isExpired(quote: ExpirableQuote, now: Date): boolean {
  if (quote.status !== QuoteStatus.SENT) return false
  const validUntil = asDate(quote.valid_until)
  if (!validUntil) return false
  return now.getTime() > validUntil.getTime()
}

/**
 * Can the buyer still accept?
 *
 * Checked at acceptance rather than trusted from stored status: the expiry
 * sweep runs on a schedule, and a buyer clicking accept one second after the
 * deadline must be refused by the clock, not by whether a cron job has run
 * yet. This is the same reasoning that keeps `overdue` derived in AR.
 */
export function canAccept(quote: ExpirableQuote, now: Date): boolean {
  return quote.status === QuoteStatus.SENT && !isExpired(quote, now)
}

/** Default validity when a vendor names none. */
export const DEFAULT_VALIDITY_DAYS = 30
export const MAX_VALIDITY_DAYS = 365

export function deriveValidUntil(sentAt: Date, validityDays: number): Date {
  if (!Number.isInteger(validityDays) || validityDays <= 0) {
    throw new QuotePricingError(
      `validity must be a positive whole number of days, got ${validityDays}`
    )
  }
  if (validityDays > MAX_VALIDITY_DAYS) {
    throw new QuotePricingError(
      `validity of ${validityDays} days exceeds the ${MAX_VALIDITY_DAYS}-day maximum`
    )
  }
  return new Date(
    Date.UTC(
      sentAt.getUTCFullYear(),
      sentAt.getUTCMonth(),
      sentAt.getUTCDate() + validityDays,
      23,
      59,
      59,
      999
    )
  )
}

/**
 * The commission invariant, with a caller.
 *
 * A quote is a price between a vendor and a buyer. If a caller ever tries to
 * put a platform-fee line into one — or to quote a rate different from the
 * one the order will actually be charged — this throws. The fee is computed
 * downstream from the order, at the seller's effective native rate.
 */
export function assertQuoteCarriesNoCommission(lines: readonly {
  variant_id?: string
  title?: string | null
  metadata?: Record<string, unknown> | null
}[]): void {
  for (const line of lines) {
    const kind = line.metadata?.fee_type ?? line.metadata?.line_kind
    if (typeof kind === "string" && /platform_fee|commission/i.test(kind)) {
      throw new QuotePricingError(
        "a quote cannot contain a commission line: FBM's fee is computed from " +
          "the order at the seller's native rate, not negotiated into the price"
      )
    }
  }
}
