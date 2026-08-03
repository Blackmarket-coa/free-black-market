import {
  VendorChargeKind,
  VendorChargeStatus,
  canTransition,
  chargeIdempotencyKey,
  isOutstanding,
  isTerminal,
  outstandingBalance,
  proratedAmount,
} from "../charges"

const S = VendorChargeStatus

describe("charge state machine", () => {
  it("allows the ordinary collection path", () => {
    expect(canTransition(S.PENDING, S.PROCESSING)).toBe(true)
    expect(canTransition(S.PROCESSING, S.PAID)).toBe(true)
  })

  it("allows a retry after failure", () => {
    // A declined card is not a dead charge. Forcing a new row per attempt
    // would make "what does this vendor owe" a query over attempt history.
    expect(canTransition(S.FAILED, S.PROCESSING)).toBe(true)
    expect(canTransition(S.FAILED, S.PAID)).toBe(true)
  })

  it("allows a refund out of paid", () => {
    // The one way out of a terminal-looking state, because a refund is a real
    // event that must be representable without rewriting history.
    expect(canTransition(S.PAID, S.REFUNDED)).toBe(true)
  })

  it("never re-opens a void or refunded charge", () => {
    // Re-opening either would let the same charge be collected twice.
    for (const to of [S.PENDING, S.PROCESSING, S.PAID, S.FAILED]) {
      expect(canTransition(S.VOID, to)).toBe(false)
      expect(canTransition(S.REFUNDED, to)).toBe(false)
    }
  })

  it("never walks a paid charge back to unpaid", () => {
    for (const to of [S.PENDING, S.PROCESSING, S.FAILED]) {
      expect(canTransition(S.PAID, to)).toBe(false)
    }
  })

  it("treats a no-op move as allowed", () => {
    // Webhook replays re-assert a status the charge already holds.
    for (const status of Object.values(S)) {
      expect(canTransition(status, status)).toBe(true)
    }
  })

  it("cannot void a charge already processing", () => {
    // The money may already be moving; voiding it would desync from Stripe.
    expect(canTransition(S.PROCESSING, S.VOID)).toBe(false)
  })

  it("reports terminal states", () => {
    expect(isTerminal(S.VOID)).toBe(true)
    expect(isTerminal(S.REFUNDED)).toBe(true)
    expect(isTerminal(S.PAID)).toBe(false)
    expect(isTerminal(S.FAILED)).toBe(false)
  })
})

describe("isOutstanding", () => {
  it("counts everything not yet collected or written off", () => {
    expect(isOutstanding(S.PENDING)).toBe(true)
    expect(isOutstanding(S.PROCESSING)).toBe(true)
    expect(isOutstanding(S.FAILED)).toBe(true)
  })

  it("excludes settled and cancelled charges", () => {
    expect(isOutstanding(S.PAID)).toBe(false)
    expect(isOutstanding(S.VOID)).toBe(false)
    expect(isOutstanding(S.REFUNDED)).toBe(false)
  })
})

describe("outstandingBalance", () => {
  const charge = (amount: number, status: VendorChargeStatus, cur = "usd") => ({
    amount,
    currency_code: cur,
    status,
  })

  it("sums only what is still owed", () => {
    expect(
      outstandingBalance([
        charge(1000, S.PENDING),
        charge(500, S.FAILED),
        charge(9999, S.PAID),
        charge(9999, S.VOID),
      ])
    ).toEqual({ amount: 1500, currency_code: "usd" })
  })

  it("is zero with nothing owed", () => {
    expect(outstandingBalance([charge(100, S.PAID)])).toEqual({
      amount: 0,
      currency_code: null,
    })
    expect(outstandingBalance([])).toEqual({ amount: 0, currency_code: null })
  })

  it("refuses to add across currencies", () => {
    // A vendor billed in two currencies needs two balances; summing them
    // silently produces a number that is wrong in both.
    expect(() =>
      outstandingBalance([charge(100, S.PENDING), charge(100, S.PENDING, "eur")])
    ).toThrow(/across currencies/)
  })

  it("normalizes currency case before comparing", () => {
    expect(
      outstandingBalance([charge(100, S.PENDING), charge(100, S.PENDING, "USD")])
    ).toEqual({ amount: 200, currency_code: "usd" })
  })
})

describe("proratedAmount", () => {
  const periodStart = new Date("2026-08-01T00:00:00Z")
  const periodEnd = new Date("2026-08-31T00:00:00Z")

  it("charges the full amount at the start of a period", () => {
    expect(
      proratedAmount({ fullAmount: 9900, periodStart, periodEnd, from: periodStart })
    ).toBe(9900)
  })

  it("charges roughly half at the midpoint", () => {
    const mid = new Date("2026-08-16T00:00:00Z")
    expect(
      proratedAmount({ fullAmount: 9900, periodStart, periodEnd, from: mid })
    ).toBe(4950)
  })

  it("charges nothing at or after the period end", () => {
    expect(
      proratedAmount({ fullAmount: 9900, periodStart, periodEnd, from: periodEnd })
    ).toBe(0)
    expect(
      proratedAmount({
        fullAmount: 9900,
        periodStart,
        periodEnd,
        from: new Date("2026-09-05T00:00:00Z"),
      })
    ).toBe(0)
  })

  it("never bills more than the plan costs", () => {
    // A clock skew putting `from` before the period start must not inflate
    // the charge.
    expect(
      proratedAmount({
        fullAmount: 9900,
        periodStart,
        periodEnd,
        from: new Date("2026-07-01T00:00:00Z"),
      })
    ).toBe(9900)
  })

  it("is zero for a zero-length period", () => {
    expect(
      proratedAmount({
        fullAmount: 9900,
        periodStart,
        periodEnd: periodStart,
        from: periodStart,
      })
    ).toBe(0)
  })
})

describe("chargeIdempotencyKey", () => {
  it("derives the same key for the same logical charge", () => {
    const parts = {
      kind: VendorChargeKind.PLAN,
      sellerId: "sel_1",
      discriminator: "pro:2026-09-01",
    }
    expect(chargeIdempotencyKey(parts)).toBe(chargeIdempotencyKey(parts))
  })

  it("separates kinds, sellers and periods", () => {
    const base = {
      kind: VendorChargeKind.PLAN,
      sellerId: "sel_1",
      discriminator: "pro:2026-09-01",
    }
    const keys = new Set([
      chargeIdempotencyKey(base),
      chargeIdempotencyKey({ ...base, kind: VendorChargeKind.PROMOTION }),
      chargeIdempotencyKey({ ...base, sellerId: "sel_2" }),
      chargeIdempotencyKey({ ...base, discriminator: "pro:2026-10-01" }),
    ])
    expect(keys.size).toBe(4)
  })
})
