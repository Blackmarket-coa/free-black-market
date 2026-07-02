/**
 * Profit-per-sqft math, from the authoritative formulas:
 *   Profit/Unit        = SellPrice − CostToProduce
 *   Units/SqFt         = 1 / FootprintSqFtPerUnit
 *   Turns/Year         = 52 / WeeksToSell
 *   Profit/SqFt/Turn   = Profit/Unit × Units/SqFt
 *   AnnualProfit/SqFt  = Profit/SqFt/Turn × Turns/Year
 */
import {
  profitPerSqFt,
  rankByAnnualProfitPerSqFt,
} from "../analytics/profit-per-sqft"

describe("profitPerSqFt", () => {
  it("computes each figure per the formulas", () => {
    // Sell $10, cost $3, 0.5 sqft/unit, 13 weeks to sell.
    const r = profitPerSqFt({
      sellPrice: 10,
      costToProduce: 3,
      footprintSqFtPerUnit: 0.5,
      weeksToSell: 13,
    })
    expect(r.profitPerUnit).toBe(7) // 10 - 3
    expect(r.unitsPerSqFt).toBe(2) // 1 / 0.5
    expect(r.turnsPerYear).toBe(4) // 52 / 13
    expect(r.profitPerSqFtPerTurn).toBe(14) // 7 * 2
    expect(r.annualProfitPerSqFt).toBe(56) // 14 * 4
  })

  it("folds vertical stacking into effective footprint", () => {
    // 3 shelf levels each hold a unit in the same ground footprint → 3× units.
    const flat = profitPerSqFt({
      sellPrice: 10,
      costToProduce: 3,
      footprintSqFtPerUnit: 0.5,
      weeksToSell: 13,
    })
    const stacked = profitPerSqFt({
      sellPrice: 10,
      costToProduce: 3,
      footprintSqFtPerUnit: 0.5,
      weeksToSell: 13,
      stackLevels: 3,
    })
    expect(stacked.unitsPerSqFt).toBeCloseTo(flat.unitsPerSqFt * 3, 4)
    expect(stacked.annualProfitPerSqFt).toBeCloseTo(flat.annualProfitPerSqFt * 3, 4)
  })

  it("rejects non-positive footprint or weeks-to-sell", () => {
    expect(() =>
      profitPerSqFt({ sellPrice: 10, costToProduce: 3, footprintSqFtPerUnit: 0, weeksToSell: 13 })
    ).toThrow()
    expect(() =>
      profitPerSqFt({ sellPrice: 10, costToProduce: 3, footprintSqFtPerUnit: 0.5, weeksToSell: 0 })
    ).toThrow()
  })

  it("ranks by AnnualProfit/SqFt (the sort key), highest first", () => {
    const ranked = rankByAnnualProfitPerSqFt([
      { label: "slow", sellPrice: 10, costToProduce: 3, footprintSqFtPerUnit: 0.5, weeksToSell: 52 },
      { label: "fast", sellPrice: 10, costToProduce: 3, footprintSqFtPerUnit: 0.5, weeksToSell: 13 },
      { label: "mid", sellPrice: 10, costToProduce: 3, footprintSqFtPerUnit: 0.5, weeksToSell: 26 },
    ])
    expect(ranked.map((r) => r.label)).toEqual(["fast", "mid", "slow"])
  })
})
