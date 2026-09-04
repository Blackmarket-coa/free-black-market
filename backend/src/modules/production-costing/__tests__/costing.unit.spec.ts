import {
  lineAmountCents,
  marginPercentAtPrice,
  priceAtMarginCents,
  resolveIsCashOutlay,
  rollupCosts,
  unitCostCents,
  type CostLine,
} from "../costing"
import { CostCategory, CostSource } from "../models/production-cost-entry"

/**
 * The costing arithmetic is the whole point of the module, so it is covered
 * here purely — no container, no database. The cases that matter are the ones a
 * naive COGS implementation gets wrong: donated inputs, unreported yield, and
 * the difference between margin-on-revenue and markup-on-cost.
 */

const line = (over: Partial<CostLine> = {}): CostLine => ({
  category: CostCategory.MATERIAL,
  amount_cents: 1000,
  is_cash_outlay: true,
  ...over,
})

describe("resolveIsCashOutlay", () => {
  it("treats purchased inputs as cash", () => {
    expect(resolveIsCashOutlay(CostSource.PURCHASED)).toBe(true)
  })

  it.each([CostSource.DONATED, CostSource.FORAGED, CostSource.OWN, CostSource.SWAP])(
    "treats %s as non-cash",
    (source) => {
      expect(resolveIsCashOutlay(source)).toBe(false)
    }
  )

  it("lets an explicit value win over the source default", () => {
    // A donated input the org still paid freight on, booked as cash.
    expect(resolveIsCashOutlay(CostSource.DONATED, true)).toBe(true)
    expect(resolveIsCashOutlay(CostSource.PURCHASED, false)).toBe(false)
  })

  it("defaults to cash when the source is unknown", () => {
    expect(resolveIsCashOutlay(null)).toBe(true)
    expect(resolveIsCashOutlay(undefined)).toBe(true)
  })
})

describe("lineAmountCents", () => {
  it("multiplies quantity by unit cost", () => {
    expect(lineAmountCents(3, 250)).toBe(750)
  })

  it("rounds to whole cents", () => {
    expect(lineAmountCents(3, 33.4)).toBe(100)
  })

  it("returns zero for missing or non-finite input", () => {
    expect(lineAmountCents(null, 250)).toBe(0)
    expect(lineAmountCents(3, null)).toBe(0)
    expect(lineAmountCents(Number.NaN, 250)).toBe(0)
  })
})

describe("rollupCosts", () => {
  it("sums an empty batch to zeros with every category present", () => {
    const rollup = rollupCosts([])
    expect(rollup.total_cents).toBe(0)
    expect(rollup.entry_count).toBe(0)
    expect(Object.keys(rollup.by_category).sort()).toEqual(
      Object.values(CostCategory).sort()
    )
  })

  it("splits cash from in-kind rather than merging them", () => {
    const rollup = rollupCosts([
      line({ amount_cents: 1000, is_cash_outlay: true }),
      line({ amount_cents: 400, is_cash_outlay: false, category: CostCategory.LABOR }),
    ])

    // Donated labor is a real cost but not cash the org had to find.
    expect(rollup.total_cents).toBe(1400)
    expect(rollup.cash_outlay_cents).toBe(1000)
    expect(rollup.in_kind_cents).toBe(400)
  })

  it("counts a line with no explicit cash flag as cash", () => {
    const rollup = rollupCosts([{ category: CostCategory.MATERIAL, amount_cents: 500 }])
    expect(rollup.cash_outlay_cents).toBe(500)
    expect(rollup.in_kind_cents).toBe(0)
  })

  it("buckets by category", () => {
    const rollup = rollupCosts([
      line({ amount_cents: 100, category: CostCategory.MATERIAL }),
      line({ amount_cents: 200, category: CostCategory.MATERIAL }),
      line({ amount_cents: 50, category: CostCategory.PACKAGING }),
      line({ amount_cents: 25, category: CostCategory.OVERHEAD }),
    ])

    expect(rollup.by_category[CostCategory.MATERIAL]).toBe(300)
    expect(rollup.by_category[CostCategory.PACKAGING]).toBe(50)
    expect(rollup.by_category[CostCategory.OVERHEAD]).toBe(25)
    expect(rollup.by_category[CostCategory.LABOR]).toBe(0)
  })

  it("keeps the total honest when a category is unknown", () => {
    // A row written by a newer migration must not vanish from the total.
    const rollup = rollupCosts([
      line({ amount_cents: 100 }),
      line({ amount_cents: 70, category: "carbon_offset" }),
    ])

    expect(rollup.total_cents).toBe(170)
    const bucketed = Object.values(rollup.by_category).reduce((a, b) => a + b, 0)
    expect(bucketed).toBe(100)
  })

  it("coerces stored bigNumber strings", () => {
    const rollup = rollupCosts([line({ amount_cents: "1250" })])
    expect(rollup.total_cents).toBe(1250)
  })
})

describe("unitCostCents", () => {
  it("divides total by realized yield", () => {
    expect(unitCostCents(1000, 4)).toBe(250)
  })

  it("rounds to whole cents", () => {
    expect(unitCostCents(1000, 3)).toBe(333)
  })

  it("returns null when yield is unknown or zero", () => {
    // A batch with no reported yield has no unit cost — not Infinity, not 0.
    expect(unitCostCents(1000, null)).toBeNull()
    expect(unitCostCents(1000, 0)).toBeNull()
    expect(unitCostCents(1000, -5)).toBeNull()
  })
})

describe("priceAtMarginCents", () => {
  it("uses margin-on-revenue, not markup-on-cost", () => {
    // 50% margin on a $4.00 cost is $8.00, not $6.00.
    expect(priceAtMarginCents(400, 50)).toBe(800)
  })

  it("returns the cost itself at zero margin", () => {
    expect(priceAtMarginCents(400, 0)).toBe(400)
  })

  it("rounds up so rounding never lands under the target", () => {
    // 333 / 0.7 = 475.71...
    expect(priceAtMarginCents(333, 30)).toBe(476)
  })

  it("returns null for margins at or above 100 percent", () => {
    expect(priceAtMarginCents(400, 100)).toBeNull()
    expect(priceAtMarginCents(400, 150)).toBeNull()
  })

  it("returns null for a negative margin or cost", () => {
    expect(priceAtMarginCents(400, -10)).toBeNull()
    expect(priceAtMarginCents(-400, 30)).toBeNull()
  })

  it("round-trips against marginPercentAtPrice", () => {
    const price = priceAtMarginCents(1000, 40)
    expect(price).not.toBeNull()
    expect(marginPercentAtPrice(1000, price as number)).toBeCloseTo(40, 1)
  })
})

describe("marginPercentAtPrice", () => {
  it("reports realized margin against revenue", () => {
    expect(marginPercentAtPrice(400, 800)).toBe(50)
  })

  it("reports a negative margin when selling below cost", () => {
    // Selling under cost is a real outcome and must be visible, not clamped.
    expect(marginPercentAtPrice(800, 400)).toBe(-100)
  })

  it("returns null for a zero or negative price", () => {
    expect(marginPercentAtPrice(400, 0)).toBeNull()
    expect(marginPercentAtPrice(400, -100)).toBeNull()
  })
})
