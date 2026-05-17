import {
  computePatronageAllocations,
  quarterKey,
  quarterBounds,
} from "../patronage-compute"

describe("patronage-compute: computePatronageAllocations", () => {
  const period_start = new Date(Date.UTC(2026, 3, 1))
  const period_end = new Date(Date.UTC(2026, 6, 1))
  const period_key = "2026-Q2"

  it("returns empty when total commission is zero", () => {
    const result = computePatronageAllocations({
      period_start,
      period_end,
      period_key,
      pool_amount: 1000,
      pool_currency: "USD",
      contributions: [
        { seller_id: "s1", commission_paid: 0 },
        { seller_id: "s2", commission_paid: 0 },
      ],
    })
    expect(result).toEqual([])
  })

  it("returns empty when pool is zero", () => {
    const result = computePatronageAllocations({
      period_start,
      period_end,
      period_key,
      pool_amount: 0,
      pool_currency: "USD",
      contributions: [{ seller_id: "s1", commission_paid: 100 }],
    })
    expect(result).toEqual([])
  })

  it("distributes pool proportionally to commission contribution", () => {
    const result = computePatronageAllocations({
      period_start,
      period_end,
      period_key,
      pool_amount: 1000,
      pool_currency: "USD",
      contributions: [
        { seller_id: "s1", commission_paid: 100 }, // 25%
        { seller_id: "s2", commission_paid: 300 }, // 75%
      ],
    })
    expect(result).toHaveLength(2)
    const byId = Object.fromEntries(result.map((r) => [r.seller_id, r]))
    expect(byId.s1.allocation_amount).toBe(250)
    expect(byId.s2.allocation_amount).toBe(750)
  })

  it("the sum of allocations matches the pool exactly (residual goes to largest contributor)", () => {
    // 3-way split of $1000 by thirds produces rounding drift.
    const result = computePatronageAllocations({
      period_start,
      period_end,
      period_key,
      pool_amount: 1000,
      pool_currency: "USD",
      contributions: [
        { seller_id: "s1", commission_paid: 100 },
        { seller_id: "s2", commission_paid: 100 },
        { seller_id: "s3", commission_paid: 100 },
      ],
    })
    const sum = result.reduce((s, r) => s + r.allocation_amount, 0)
    expect(sum).toBe(1000)
  })

  it("drops zero-contribution sellers from the result", () => {
    const result = computePatronageAllocations({
      period_start,
      period_end,
      period_key,
      pool_amount: 100,
      pool_currency: "USD",
      contributions: [
        { seller_id: "s1", commission_paid: 50 },
        { seller_id: "s_zero", commission_paid: 0 },
      ],
    })
    expect(result.find((r) => r.seller_id === "s_zero")).toBeUndefined()
    expect(result).toHaveLength(1)
  })

  it("tags every row with the period boundaries and key", () => {
    const result = computePatronageAllocations({
      period_start,
      period_end,
      period_key,
      pool_amount: 100,
      pool_currency: "USD",
      contributions: [{ seller_id: "s1", commission_paid: 50 }],
    })
    expect(result[0].period_start).toBe(period_start)
    expect(result[0].period_end).toBe(period_end)
    expect(result[0].period_key).toBe(period_key)
    expect(result[0].allocation_currency).toBe("USD")
  })
})

describe("patronage-compute: quarterKey + quarterBounds", () => {
  it("Q1 spans Jan-Mar", () => {
    expect(quarterKey(new Date(Date.UTC(2026, 0, 15)))).toBe("2026-Q1")
    expect(quarterKey(new Date(Date.UTC(2026, 2, 31, 23, 59)))).toBe("2026-Q1")
  })

  it("Q2 spans Apr-Jun", () => {
    expect(quarterKey(new Date(Date.UTC(2026, 3, 1)))).toBe("2026-Q2")
    expect(quarterKey(new Date(Date.UTC(2026, 5, 30)))).toBe("2026-Q2")
  })

  it("Q4 spans Oct-Dec", () => {
    expect(quarterKey(new Date(Date.UTC(2026, 9, 1)))).toBe("2026-Q4")
    expect(quarterKey(new Date(Date.UTC(2026, 11, 31)))).toBe("2026-Q4")
  })

  it("quarterBounds is a half-open interval", () => {
    const b = quarterBounds(new Date(Date.UTC(2026, 4, 15)))
    expect(b.start).toEqual(new Date(Date.UTC(2026, 3, 1)))
    expect(b.end).toEqual(new Date(Date.UTC(2026, 6, 1)))
  })
})
