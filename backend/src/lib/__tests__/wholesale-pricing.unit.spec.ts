import {
  WHOLESALE_DISCOUNT_METADATA_KEY,
  checkWholesaleMinimums,
  computeWholesaleUnitPriceMinor,
} from "../wholesale-pricing"

describe("wholesale-pricing: invariants", () => {
  it("exports a stable metadata key for the applied discount", () => {
    expect(WHOLESALE_DISCOUNT_METADATA_KEY).toBe("wholesale_discount_percent")
  })
})

describe("wholesale-pricing: computeWholesaleUnitPriceMinor", () => {
  it("0 % discount returns the base unchanged", () => {
    expect(computeWholesaleUnitPriceMinor(1000, 0)).toBe(1000)
  })

  it("100 % discount returns 0", () => {
    expect(computeWholesaleUnitPriceMinor(1000, 100)).toBe(0)
  })

  it("applies an exact percentage", () => {
    // the default Plant Network wholesale tier is 45 %
    expect(computeWholesaleUnitPriceMinor(1000, 45)).toBe(550)
    expect(computeWholesaleUnitPriceMinor(2000, 25)).toBe(1500)
  })

  it("rounds half-up to the nearest minor unit", () => {
    // 999 * 0.55 = 549.45 -> 549
    expect(computeWholesaleUnitPriceMinor(999, 45)).toBe(549)
    // 10 * 0.95 = 9.5 -> 10 (half-up, consistent with sliding-scale)
    expect(computeWholesaleUnitPriceMinor(10, 5)).toBe(10)
    // 101 * 0.67 = 67.67 -> 68
    expect(computeWholesaleUnitPriceMinor(101, 33)).toBe(68)
  })

  it("supports fractional discount percentages", () => {
    // 999 * 0.875 = 874.125 -> 874
    expect(computeWholesaleUnitPriceMinor(999, 12.5)).toBe(874)
  })

  it("rounds a non-integer base before discounting", () => {
    expect(computeWholesaleUnitPriceMinor(1000.4, 0)).toBe(1000)
    // round(1000.6) = 1001; 1001 * 0.9 = 900.9 -> 901
    expect(computeWholesaleUnitPriceMinor(1000.6, 10)).toBe(901)
  })

  it("treats a negative or non-finite discount as no discount", () => {
    expect(computeWholesaleUnitPriceMinor(1000, -5)).toBe(1000)
    expect(computeWholesaleUnitPriceMinor(1000, NaN)).toBe(1000)
    expect(computeWholesaleUnitPriceMinor(1000, -Infinity)).toBe(1000)
  })

  it("clamps discounts above 100 % to a 0 price (never negative)", () => {
    expect(computeWholesaleUnitPriceMinor(1000, 150)).toBe(0)
    expect(computeWholesaleUnitPriceMinor(1000, Infinity)).toBe(0)
  })

  it("returns 0 for non-finite or negative bases (never writes negative)", () => {
    expect(computeWholesaleUnitPriceMinor(NaN, 45)).toBe(0)
    expect(computeWholesaleUnitPriceMinor(-100, 45)).toBe(0)
    expect(computeWholesaleUnitPriceMinor(Infinity, 45)).toBe(0)
  })

  it("a 0 base stays 0 at any discount", () => {
    expect(computeWholesaleUnitPriceMinor(0, 0)).toBe(0)
    expect(computeWholesaleUnitPriceMinor(0, 45)).toBe(0)
    expect(computeWholesaleUnitPriceMinor(0, 100)).toBe(0)
  })
})

describe("wholesale-pricing: checkWholesaleMinimums", () => {
  const items = (
    ...pairs: Array<[quantity: number, unitPriceMinor: number]>
  ) => pairs.map(([quantity, unitPriceMinor]) => ({ quantity, unitPriceMinor }))

  it("passes when no minimums are configured (defaults 0 / 1)", () => {
    expect(
      checkWholesaleMinimums({
        items: items([1, 100]),
        minOrderItems: 1,
        minOrderValueMinor: 0,
      })
    ).toEqual({ ok: true, unmet: [] })
  })

  it("min_order_items of 1 is a no-op even on an empty cart (validateOrder parity)", () => {
    expect(
      checkWholesaleMinimums({
        items: [],
        minOrderItems: 1,
        minOrderValueMinor: 0,
      })
    ).toEqual({ ok: true, unmet: [] })
  })

  it("reports a value shortfall in minor units", () => {
    // 2 * 1000 + 1 * 500 = 2500 < 5000
    expect(
      checkWholesaleMinimums({
        items: items([2, 1000], [1, 500]),
        minOrderItems: 1,
        minOrderValueMinor: 5000,
      })
    ).toEqual({
      ok: false,
      unmet: [{ code: "min_order_value", required: 5000, actual: 2500 }],
    })
  })

  it("reports an item-count shortfall (sums quantities across lines)", () => {
    expect(
      checkWholesaleMinimums({
        items: items([2, 1000], [1, 1000]),
        minOrderItems: 5,
        minOrderValueMinor: 0,
      })
    ).toEqual({
      ok: false,
      unmet: [{ code: "min_order_items", required: 5, actual: 3 }],
    })
  })

  it("reports both shortfalls, value first (validateOrder order)", () => {
    const result = checkWholesaleMinimums({
      items: items([1, 100]),
      minOrderItems: 10,
      minOrderValueMinor: 5000,
    })
    expect(result.ok).toBe(false)
    expect(result.unmet).toEqual([
      { code: "min_order_value", required: 5000, actual: 100 },
      { code: "min_order_items", required: 10, actual: 1 },
    ])
  })

  it("meeting a minimum exactly passes (>= boundary)", () => {
    expect(
      checkWholesaleMinimums({
        items: items([5, 1000]),
        minOrderItems: 5,
        minOrderValueMinor: 5000,
      })
    ).toEqual({ ok: true, unmet: [] })
  })

  it("waive skips both checks even when both would fail", () => {
    expect(
      checkWholesaleMinimums({
        items: [],
        minOrderItems: 10,
        minOrderValueMinor: 5000,
        waive: true,
      })
    ).toEqual({ ok: true, unmet: [] })
  })

  it("only waive === true waives (no truthy coercion)", () => {
    const result = checkWholesaleMinimums({
      items: [],
      minOrderItems: 10,
      minOrderValueMinor: 0,
      waive: undefined,
    })
    expect(result.ok).toBe(false)
  })

  it("sums fractional quantities (weight items)", () => {
    // 2.5 lb * 400 = 1000
    expect(
      checkWholesaleMinimums({
        items: items([2.5, 400]),
        minOrderItems: 2,
        minOrderValueMinor: 1000,
      })
    ).toEqual({ ok: true, unmet: [] })
  })

  it("treats garbage quantities and prices as 0", () => {
    const result = checkWholesaleMinimums({
      items: [
        { quantity: NaN, unitPriceMinor: 1000 },
        { quantity: -2, unitPriceMinor: 1000 },
        { quantity: 1, unitPriceMinor: NaN },
        { quantity: 1, unitPriceMinor: -500 },
      ],
      minOrderItems: 3,
      minOrderValueMinor: 100,
    })
    expect(result.ok).toBe(false)
    expect(result.unmet).toEqual([
      { code: "min_order_value", required: 100, actual: 0 },
      { code: "min_order_items", required: 3, actual: 2 },
    ])
  })

  it("non-finite configured minimums are treated as unset", () => {
    expect(
      checkWholesaleMinimums({
        items: items([1, 100]),
        minOrderItems: NaN,
        minOrderValueMinor: NaN,
      })
    ).toEqual({ ok: true, unmet: [] })
  })
})
