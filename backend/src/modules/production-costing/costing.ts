/**
 * Costing arithmetic — pure, I/O-free, and the only place rounding happens.
 *
 * Kept out of the service so the money rules can be tested exhaustively without
 * a database, and reused by any caller that already holds cost lines in memory.
 * Every figure is integer cents; nothing here ever returns a fractional cent.
 */

import { CostCategory, CostSource } from "./models/production-cost-entry"

/** The minimum shape the rollup needs. Real model rows satisfy it. */
export interface CostLine {
  category: CostCategory | string
  amount_cents: number | string | bigint
  is_cash_outlay?: boolean | null
}

export interface CostRollup {
  /** Full economic cost of the batch, donated inputs included. */
  total_cents: number
  /** The part that actually required cash. */
  cash_outlay_cents: number
  /** The part contributed in kind (donated / foraged / own / swapped). */
  in_kind_cents: number
  /** Totals per category; every category is present, zero when unused. */
  by_category: Record<CostCategory, number>
  entry_count: number
}

/** Sources that bring no cash outlay with them unless the caller says otherwise. */
const NON_CASH_SOURCES: ReadonlySet<string> = new Set<string>([
  CostSource.DONATED,
  CostSource.FORAGED,
  CostSource.OWN,
  CostSource.SWAP,
])

/**
 * Whether a line represents cash that left the organisation. An explicit
 * caller-supplied value always wins; otherwise it is derived from the source, so
 * "donated" never silently inflates the cash figure.
 */
export function resolveIsCashOutlay(
  source: CostSource | string | null | undefined,
  explicit?: boolean | null
): boolean {
  if (typeof explicit === "boolean") return explicit
  if (!source) return true
  return !NON_CASH_SOURCES.has(source)
}

/** Coerces a stored bigNumber/string/number amount to an integer cent count. */
function toCents(value: number | string | bigint | null | undefined): number {
  if (value === null || value === undefined) return 0
  const n = typeof value === "bigint" ? Number(value) : Number(value)
  return Number.isFinite(n) ? Math.round(n) : 0
}

/**
 * Line total from an entry's quantity and unit cost. Used when a caller supplies
 * quantity x unit price rather than a pre-computed total.
 */
export function lineAmountCents(
  quantity: number | null | undefined,
  unitAmountCents: number | null | undefined
): number {
  const q = Number(quantity ?? 0)
  const u = Number(unitAmountCents ?? 0)
  if (!Number.isFinite(q) || !Number.isFinite(u)) return 0
  return Math.round(q * u)
}

function emptyByCategory(): Record<CostCategory, number> {
  return {
    [CostCategory.MATERIAL]: 0,
    [CostCategory.LABOR]: 0,
    [CostCategory.PACKAGING]: 0,
    [CostCategory.FREIGHT_IN]: 0,
    [CostCategory.OVERHEAD]: 0,
  }
}

/**
 * Sums cost lines into a batch rollup. Unknown categories are counted in the
 * totals but not attributed to a category bucket, so a future category added by
 * a migration can never make the totals disagree with the sum of the buckets it
 * knows about.
 */
export function rollupCosts(lines: readonly CostLine[]): CostRollup {
  const by_category = emptyByCategory()
  let total_cents = 0
  let cash_outlay_cents = 0

  for (const line of lines) {
    const amount = toCents(line.amount_cents)
    total_cents += amount
    if (line.is_cash_outlay !== false) cash_outlay_cents += amount
    if (line.category in by_category) {
      by_category[line.category as CostCategory] += amount
    }
  }

  return {
    total_cents,
    cash_outlay_cents,
    in_kind_cents: total_cents - cash_outlay_cents,
    by_category,
    entry_count: lines.length,
  }
}

/**
 * Cost to produce one sellable unit. Null when yield is unknown or zero — a
 * batch that has not reported yield has no meaningful unit cost, and returning
 * null keeps callers from dividing by zero or quoting Infinity as a price.
 */
export function unitCostCents(
  totalCents: number,
  yieldQty: number | null | undefined
): number | null {
  const y = Number(yieldQty ?? 0)
  if (!Number.isFinite(y) || y <= 0) return null
  return Math.round(totalCents / y)
}

/**
 * Price that yields `marginPercent` gross margin on `unitCostCents`, where
 * margin is measured against revenue (price), the way a P&L reads it:
 *
 *   price = cost / (1 - margin/100)
 *
 * Rounds up, so rounding never quietly lands the seller under their target.
 * Null for a margin outside [0, 100) — 100% margin implies an infinite price,
 * and a negative target is a mistake worth surfacing rather than honouring.
 */
export function priceAtMarginCents(
  unitCostCents: number,
  marginPercent: number
): number | null {
  if (!Number.isFinite(unitCostCents) || unitCostCents < 0) return null
  if (!Number.isFinite(marginPercent)) return null
  if (marginPercent < 0 || marginPercent >= 100) return null
  return Math.ceil(unitCostCents / (1 - marginPercent / 100))
}

/**
 * Realized gross margin percent at a given price. Null when the price is zero
 * or negative (a giveaway has no margin to report). Can legitimately be
 * negative: selling below cost is a real, and worth-seeing, outcome.
 */
export function marginPercentAtPrice(
  unitCostCents: number,
  priceCents: number
): number | null {
  if (!Number.isFinite(priceCents) || priceCents <= 0) return null
  if (!Number.isFinite(unitCostCents)) return null
  return ((priceCents - unitCostCents) / priceCents) * 100
}
