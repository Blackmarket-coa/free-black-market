/**
 * Profit-per-square-foot analytics (decision-support ONLY).
 *
 * This is a growing-decision tool, deliberately kept SEPARATE from any
 * lender-grade export — its inputs allow overrides and estimates, so its output
 * must never flow into a quest packet's financial exhibits (those trace to the
 * ledger). It is fully usable with no quest enrolled.
 *
 * Authoritative math (from the spec):
 *   Profit/Unit        = SellPrice − CostToProduce
 *   Units/SqFt         = 1 / FootprintSqFtPerUnit
 *   Turns/Year         = 52 / WeeksToSell
 *   Profit/SqFt/Turn   = Profit/Unit × Units/SqFt
 *   AnnualProfit/SqFt  = Profit/SqFt/Turn × Turns/Year   // sortable ranking key
 *
 * Vertical stacking: a shelf level is its own square footage, so callers pass
 * the *effective* footprint per unit (bench footprint ÷ stack levels). We accept
 * `stackLevels` and fold it in so the input stays intuitive.
 */

export interface ProfitPerSqFtInput {
  /** Sell price per unit (major units). May come from real data or override. */
  sellPrice: number
  /** Cost to produce one unit (major units). */
  costToProduce: number
  /** Bench/ground footprint occupied by one unit, in square feet (> 0). */
  footprintSqFtPerUnit: number
  /** Weeks from start to sold (> 0). Drives turns/year. */
  weeksToSell: number
  /** Vertical stacking: number of shelf levels sharing the footprint (>= 1). */
  stackLevels?: number
  /** Optional label for ranking output. */
  label?: string
}

export interface ProfitPerSqFtResult {
  label?: string
  profitPerUnit: number
  unitsPerSqFt: number
  turnsPerYear: number
  profitPerSqFtPerTurn: number
  annualProfitPerSqFt: number
}

const WEEKS_PER_YEAR = 52

export function profitPerSqFt(input: ProfitPerSqFtInput): ProfitPerSqFtResult {
  const stack = input.stackLevels && input.stackLevels > 0 ? input.stackLevels : 1

  // Vertical stacking multiplies the units a given footprint holds: a shelf
  // level is its own sqft, so effective footprint per unit shrinks by `stack`.
  const effectiveFootprint = input.footprintSqFtPerUnit / stack

  if (!(effectiveFootprint > 0)) {
    throw new Error("footprintSqFtPerUnit (and stackLevels) must yield a positive footprint")
  }
  if (!(input.weeksToSell > 0)) {
    throw new Error("weeksToSell must be greater than 0")
  }

  const profitPerUnit = input.sellPrice - input.costToProduce
  const unitsPerSqFt = 1 / effectiveFootprint
  const turnsPerYear = WEEKS_PER_YEAR / input.weeksToSell
  const profitPerSqFtPerTurn = profitPerUnit * unitsPerSqFt
  const annualProfitPerSqFt = profitPerSqFtPerTurn * turnsPerYear

  return {
    label: input.label,
    profitPerUnit: round(profitPerUnit),
    unitsPerSqFt: round(unitsPerSqFt),
    turnsPerYear: round(turnsPerYear),
    profitPerSqFtPerTurn: round(profitPerSqFtPerTurn),
    annualProfitPerSqFt: round(annualProfitPerSqFt),
  }
}

/** Rank rows by AnnualProfit/SqFt (the sortable key), highest first. */
export function rankByAnnualProfitPerSqFt(
  inputs: ProfitPerSqFtInput[]
): ProfitPerSqFtResult[] {
  return inputs
    .map(profitPerSqFt)
    .sort((a, b) => b.annualProfitPerSqFt - a.annualProfitPerSqFt)
}

function round(n: number): number {
  return Math.round((n + Number.EPSILON) * 10000) / 10000
}
