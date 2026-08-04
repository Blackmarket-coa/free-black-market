import {
  EMBED_REQUEST_BLOCK,
  EMBED_REQUEST_BLOCK_CENTS,
  computeOverage,
  isUsageMetric,
  previousUsagePeriod,
  usagePeriodFor,
  usagePeriodKey,
} from "../overage"
import { limitsForPlan } from "../limits"

describe("computeOverage", () => {
  const included = 1_000

  it("bills nothing within the allowance", () => {
    const r = computeOverage({ recorded: 999, included })
    expect(r.billable).toBe(false)
    expect(r.amount_cents).toBe(0)
    expect(r.excess).toBe(0)
  })

  it("bills nothing exactly at the allowance", () => {
    // The allowance is inclusive: 1000 included means the 1000th is free.
    expect(computeOverage({ recorded: 1_000, included }).billable).toBe(false)
  })

  it("rounds a started block up to a whole block", () => {
    // One request past the allowance buys a whole block. Rounding down would
    // make the last partial block free for every seller, every month.
    const r = computeOverage({ recorded: 1_001, included })
    expect(r.excess).toBe(1)
    expect(r.blocks).toBe(1)
    expect(r.amount_cents).toBe(EMBED_REQUEST_BLOCK_CENTS)
    expect(r.billable).toBe(true)
  })

  it("charges per whole block as usage grows", () => {
    const r = computeOverage({ recorded: 1_000 + EMBED_REQUEST_BLOCK * 3, included })
    expect(r.blocks).toBe(3)
    expect(r.amount_cents).toBe(EMBED_REQUEST_BLOCK_CENTS * 3)
  })

  it("never bills an unlimited allowance", () => {
    // This is the whole meaning of null, and the operator plan depends on it.
    const r = computeOverage({ recorded: 500_000_000, included: null })
    expect(r.billable).toBe(false)
    expect(r.amount_cents).toBe(0)
  })

  it("treats a zero allowance as real, billing from the first unit", () => {
    const r = computeOverage({ recorded: 1, included: 0 })
    expect(r.billable).toBe(true)
    expect(r.blocks).toBe(1)
  })

  it("meters without charging when the price is zero", () => {
    // A real operator state: measuring before switching billing on. It must
    // not produce a zero-amount charge row.
    const r = computeOverage({ recorded: 10_000, included, centsPerBlock: 0 })
    expect(r.excess).toBeGreaterThan(0)
    expect(r.blocks).toBeGreaterThan(0)
    expect(r.amount_cents).toBe(0)
    expect(r.billable).toBe(false)
  })

  it("clamps nonsense recorded values rather than propagating them", () => {
    expect(computeOverage({ recorded: -5, included }).recorded).toBe(0)
    expect(computeOverage({ recorded: NaN, included }).recorded).toBe(0)
    expect(computeOverage({ recorded: 1_500.9, included }).recorded).toBe(1_500)
  })

  it("never returns a negative amount", () => {
    for (const recorded of [0, 1, 999, 1_000, 1_001, 10_000]) {
      expect(computeOverage({ recorded, included }).amount_cents).toBeGreaterThanOrEqual(0)
    }
  })

  it("prices every plan's included volume consistently", () => {
    // A seller one request over on any plan pays exactly one block.
    for (const code of ["free", "starter", "pro", "scale"]) {
      const allowance = limitsForPlan(code).included_embed_requests as number
      const r = computeOverage({ recorded: allowance + 1, included: allowance })
      expect(r.blocks).toBe(1)
      expect(r.amount_cents).toBe(EMBED_REQUEST_BLOCK_CENTS)
    }
    // …and the operator plan is never billable at any volume.
    expect(
      computeOverage({
        recorded: 10_000_000,
        included: limitsForPlan("internal").included_embed_requests,
      }).billable
    ).toBe(false)
  })
})

describe("usage periods", () => {
  it("bounds the calendar month in UTC, half-open", () => {
    const { start, end } = usagePeriodFor(new Date("2026-08-15T13:45:00.000Z"))
    expect(start.toISOString()).toBe("2026-08-01T00:00:00.000Z")
    expect(end.toISOString()).toBe("2026-09-01T00:00:00.000Z")
  })

  it("puts the first instant of a month in that month, not the previous one", () => {
    const { start } = usagePeriodFor(new Date("2026-08-01T00:00:00.000Z"))
    expect(start.toISOString()).toBe("2026-08-01T00:00:00.000Z")
  })

  it("rolls the year boundary correctly", () => {
    const { start, end } = usagePeriodFor(new Date("2026-12-31T23:59:59.999Z"))
    expect(start.toISOString()).toBe("2026-12-01T00:00:00.000Z")
    expect(end.toISOString()).toBe("2027-01-01T00:00:00.000Z")
  })

  it("resolves the previous period across a year boundary", () => {
    const prev = previousUsagePeriod(new Date("2027-01-05T00:00:00.000Z"))
    expect(prev.start.toISOString()).toBe("2026-12-01T00:00:00.000Z")
    expect(prev.end.toISOString()).toBe("2027-01-01T00:00:00.000Z")
  })

  it("keys a period stably for idempotency", () => {
    expect(usagePeriodKey(new Date("2026-08-01T00:00:00.000Z"))).toBe("2026-08")
    // Zero-padded, so keys sort lexically in calendar order.
    expect(usagePeriodKey(new Date("2026-01-01T00:00:00.000Z"))).toBe("2026-01")
  })
})

describe("isUsageMetric", () => {
  it("accepts metered metrics and rejects capped ones", () => {
    expect(isUsageMetric("embed_requests")).toBe(true)
    // Stock resources are capped, not metered — they must not be meterable by
    // accident, or a forgotten key would become a recurring charge.
    expect(isUsageMetric("embed_keys")).toBe(false)
    expect(isUsageMetric("")).toBe(false)
    expect(isUsageMetric(null)).toBe(false)
  })
})

describe("EMBED_REQUEST_BLOCK", () => {
  it("is a positive block size", () => {
    expect(EMBED_REQUEST_BLOCK).toBeGreaterThan(0)
  })
})
