import {
  DEFAULT_VALIDITY_DAYS,
  MAX_VALIDITY_DAYS,
  QuotePricingError,
  QuoteStateError,
  QuoteStatus,
  assertQuoteCarriesNoCommission,
  assertQuoteTransition,
  canAccept,
  deriveValidUntil,
  isAllowedQuoteTransition,
  isExpired,
  isTerminal,
  priceLine,
  totalQuote,
} from "../pricing"

const at = (iso: string) => new Date(iso)

describe("quote pricing: priceLine", () => {
  it("multiplies out a line", () => {
    const line = priceLine({ variant_id: "v1", quantity: 12, unit_price: 250 })
    expect(line.line_subtotal).toBe(3_000)
  })

  it("reports savings against list", () => {
    const line = priceLine({
      variant_id: "v1",
      quantity: 10,
      unit_price: 800,
      list_unit_price: 1_000,
    })
    expect(line.line_savings).toBe(2_000)
  })

  it("never reports negative savings when quoted above list", () => {
    // Rush work and small batches legitimately price above list; showing that
    // as negative savings would read as a discount that is not there.
    const line = priceLine({
      variant_id: "v1",
      quantity: 5,
      unit_price: 1_200,
      list_unit_price: 1_000,
    })
    expect(line.line_savings).toBe(0)
  })

  it("treats an unknown list price as no savings, not as zero list", () => {
    const line = priceLine({ variant_id: "v1", quantity: 2, unit_price: 500 })
    expect(line.list_unit_price).toBeNull()
    expect(line.line_savings).toBe(0)
  })

  it("refuses a fractional or non-positive quantity", () => {
    expect(() =>
      priceLine({ variant_id: "v1", quantity: 1.5, unit_price: 100 })
    ).toThrow(QuotePricingError)
    expect(() =>
      priceLine({ variant_id: "v1", quantity: 0, unit_price: 100 })
    ).toThrow(QuotePricingError)
    expect(() =>
      priceLine({ variant_id: "v1", quantity: -3, unit_price: 100 })
    ).toThrow(QuotePricingError)
  })

  it("refuses a fractional cent", () => {
    // Accepting one makes the accepted cart's total disagree with the quote,
    // and the disagreement surfaces at checkout in front of the customer.
    expect(() =>
      priceLine({ variant_id: "v1", quantity: 3, unit_price: 99.5 })
    ).toThrow(QuotePricingError)
  })

  it("allows a zero unit price (a sample, a thrown-in line)", () => {
    expect(
      priceLine({ variant_id: "v1", quantity: 1, unit_price: 0 }).line_subtotal
    ).toBe(0)
  })
})

describe("quote pricing: totalQuote", () => {
  const lines = [
    { variant_id: "v1", quantity: 10, unit_price: 800, list_unit_price: 1_000 },
    { variant_id: "v2", quantity: 4, unit_price: 2_500, list_unit_price: 2_500 },
    { variant_id: "v3", quantity: 2, unit_price: 150 },
  ]

  it("sums subtotals and item counts", () => {
    const totals = totalQuote(lines)
    expect(totals.subtotal).toBe(8_000 + 10_000 + 300)
    expect(totals.line_count).toBe(3)
    expect(totals.item_count).toBe(16)
  })

  it("keeps subtotal + savings === list_subtotal for every quote", () => {
    // Including quotes with partially-unknown list prices — a total that only
    // balances sometimes is a total nobody can check.
    const totals = totalQuote(lines)
    expect(totals.subtotal + totals.savings).toBe(totals.list_subtotal)
  })

  it("balances when no line has a list price at all", () => {
    const totals = totalQuote([
      { variant_id: "v1", quantity: 2, unit_price: 500 },
    ])
    expect(totals.savings).toBe(0)
    expect(totals.subtotal).toBe(totals.list_subtotal)
  })

  it("totals an empty basket to zero rather than throwing", () => {
    expect(totalQuote([])).toEqual({
      subtotal: 0,
      list_subtotal: 0,
      savings: 0,
      line_count: 0,
      item_count: 0,
      max_lead_time_days: null,
    })
  })
})

describe("quote pricing: validity", () => {
  it("defaults to 30 days, ending at end of day", () => {
    const until = deriveValidUntil(at("2026-09-02T10:00:00Z"), DEFAULT_VALIDITY_DAYS)
    expect(until.toISOString().slice(0, 10)).toBe("2026-10-02")
    expect(until.getUTCHours()).toBe(23)
  })

  it("refuses a non-positive or absurd validity", () => {
    expect(() => deriveValidUntil(at("2026-09-02T00:00:00Z"), 0)).toThrow(
      QuotePricingError
    )
    expect(() =>
      deriveValidUntil(at("2026-09-02T00:00:00Z"), MAX_VALIDITY_DAYS + 1)
    ).toThrow(QuotePricingError)
  })
})

describe("quote pricing: expiry", () => {
  const sent = {
    status: QuoteStatus.SENT,
    valid_until: at("2026-09-30T23:59:59.999Z"),
  }

  it("expires only after the deadline passes", () => {
    expect(isExpired(sent, at("2026-09-30T12:00:00Z"))).toBe(false)
    expect(isExpired(sent, at("2026-10-01T00:00:01Z"))).toBe(true)
  })

  it("never expires a draft — the buyer has never seen it", () => {
    expect(
      isExpired(
        { status: QuoteStatus.DRAFT, valid_until: at("2020-01-01T00:00:00Z") },
        at("2026-10-01T00:00:00Z")
      )
    ).toBe(false)
  })

  it("never re-expires a quote that already ended", () => {
    // Marking an accepted quote expired would overwrite what happened to it.
    for (const status of [
      QuoteStatus.ACCEPTED,
      QuoteStatus.DECLINED,
      QuoteStatus.WITHDRAWN,
      QuoteStatus.EXPIRED,
    ]) {
      expect(
        isExpired(
          { status, valid_until: at("2020-01-01T00:00:00Z") },
          at("2026-10-01T00:00:00Z")
        )
      ).toBe(false)
    }
  })

  it("refuses acceptance a second past the deadline", () => {
    // The sweep runs on a schedule; the clock decides, not the cron job.
    expect(canAccept(sent, at("2026-09-30T23:59:59.998Z"))).toBe(true)
    expect(canAccept(sent, at("2026-10-01T00:00:00.001Z"))).toBe(false)
  })

  it("never lets a draft be accepted", () => {
    expect(
      canAccept({ status: QuoteStatus.DRAFT, valid_until: null }, new Date())
    ).toBe(false)
  })
})

describe("quote pricing: lifecycle", () => {
  it("allows the real path", () => {
    expect(isAllowedQuoteTransition(QuoteStatus.DRAFT, QuoteStatus.SENT)).toBe(true)
    expect(isAllowedQuoteTransition(QuoteStatus.SENT, QuoteStatus.ACCEPTED)).toBe(true)
    expect(isAllowedQuoteTransition(QuoteStatus.SENT, QuoteStatus.DECLINED)).toBe(true)
    expect(isAllowedQuoteTransition(QuoteStatus.SENT, QuoteStatus.EXPIRED)).toBe(true)
  })

  it("never lets a buyer accept a draft they cannot see", () => {
    expect(isAllowedQuoteTransition(QuoteStatus.DRAFT, QuoteStatus.ACCEPTED)).toBe(
      false
    )
  })

  it("treats every ending as terminal", () => {
    for (const status of [
      QuoteStatus.ACCEPTED,
      QuoteStatus.DECLINED,
      QuoteStatus.WITHDRAWN,
      QuoteStatus.EXPIRED,
    ]) {
      expect(isTerminal(status)).toBe(true)
      expect(isAllowedQuoteTransition(status, QuoteStatus.SENT)).toBe(false)
    }
    expect(isTerminal(QuoteStatus.DRAFT)).toBe(false)
    expect(isTerminal(QuoteStatus.SENT)).toBe(false)
  })

  it("cannot resurrect an expired quote as accepted", () => {
    expect(() =>
      assertQuoteTransition(QuoteStatus.EXPIRED, QuoteStatus.ACCEPTED)
    ).toThrow(QuoteStateError)
  })
})

describe("quote pricing: the 3% invariant", () => {
  it("accepts ordinary lines", () => {
    expect(() =>
      assertQuoteCarriesNoCommission([
        { variant_id: "v1", title: "Elderberry liners" },
      ])
    ).not.toThrow()
  })

  it("refuses a negotiated platform-fee line", () => {
    // FBM's fee is computed from the order at the seller's native rate. A
    // quote that names its own commission is negotiating our side of the deal.
    expect(() =>
      assertQuoteCarriesNoCommission([
        { variant_id: "v1", metadata: { fee_type: "PLATFORM_FEE" } },
      ])
    ).toThrow(QuotePricingError)

    expect(() =>
      assertQuoteCarriesNoCommission([
        { variant_id: "v1", metadata: { line_kind: "commission" } },
      ])
    ).toThrow(/commission line/)
  })

  it("leaves an external channel fee alone — that is not ours to refuse", () => {
    expect(() =>
      assertQuoteCarriesNoCommission([
        { variant_id: "v1", metadata: { fee_type: "CHANNEL_FEE" } },
      ])
    ).not.toThrow()
  })
})

describe("quote pricing: lead time", () => {
  it("accepts a stated lead time and keeps null distinct from 0", () => {
    expect(priceLine({ variant_id: "v", quantity: 1, unit_price: 1, lead_time_days: 14 }).lead_time_days).toBe(14)
    expect(priceLine({ variant_id: "v", quantity: 1, unit_price: 1, lead_time_days: 0 }).lead_time_days).toBe(0)
    expect(priceLine({ variant_id: "v", quantity: 1, unit_price: 1 }).lead_time_days).toBeNull()
  })

  it("refuses a negative or fractional lead time", () => {
    expect(() =>
      priceLine({ variant_id: "v", quantity: 1, unit_price: 1, lead_time_days: -1 })
    ).toThrow(QuotePricingError)
    expect(() =>
      priceLine({ variant_id: "v", quantity: 1, unit_price: 1, lead_time_days: 2.5 })
    ).toThrow(QuotePricingError)
  })

  it("reports the basket's lead time as the MAX across lines, not the sum", () => {
    // Lines are produced in parallel; the buyer asks when the order arrives.
    const totals = totalQuote([
      { variant_id: "a", quantity: 1, unit_price: 1, lead_time_days: 3 },
      { variant_id: "b", quantity: 1, unit_price: 1, lead_time_days: 21 },
      { variant_id: "c", quantity: 1, unit_price: 1 },
    ])
    expect(totals.max_lead_time_days).toBe(21)
  })

  it("reports null when no line states a lead time", () => {
    expect(
      totalQuote([{ variant_id: "a", quantity: 1, unit_price: 1 }]).max_lead_time_days
    ).toBeNull()
  })
})
