import {
  SETTLEMENT_REFERENCE_TYPE,
  checkCompliance,
  hasSettlementCitation,
  isPurposeRestricted,
  isTimeRestricted,
  isWithinSpendPeriod,
  rollupFund,
  settlementHeadroomCents,
  spendHeadroomCents,
  type FundEntry,
  type FundTerms,
} from "../fund-math"
import { FundRestriction } from "../models/fund"
import { FundEntryType } from "../models/fund-transaction"

/**
 * The compliance tests are the reason this module exists, so they are covered
 * purely — no container, no database. The cases that matter are the ones that
 * actually cost an organisation a grant: spending past the award, spending
 * outside the period, and spending on the wrong program.
 */

// Every expenditure the factory makes cites a settlement by default: the
// citation rule is tested on its own below, and the guards under test here
// (award, period, purpose) should not trip over it.
const entry = (over: Partial<FundEntry> = {}): FundEntry => ({
  id: "ft_1",
  entry_type: FundEntryType.EXPENDITURE,
  amount_cents: 1000,
  occurred_at: "2026-06-01T00:00:00Z",
  program_id: null,
  reference_type: SETTLEMENT_REFERENCE_TYPE,
  reference_id: "hle_1",
  ...over,
})

const terms = (over: Partial<FundTerms> = {}): FundTerms => ({
  restriction: FundRestriction.UNRESTRICTED,
  ...over,
})

describe("rollupFund", () => {
  it("sums an empty fund to zeros", () => {
    const r = rollupFund([])
    expect(r.awarded_cents).toBe(0)
    expect(r.unspent_award_cents).toBe(0)
    expect(r.entry_count).toBe(0)
  })

  it("keeps award, receipt and spend as separate questions", () => {
    const r = rollupFund([
      entry({ entry_type: FundEntryType.AWARD, amount_cents: 100_000 }),
      entry({ entry_type: FundEntryType.RECEIPT, amount_cents: 60_000 }),
      entry({ entry_type: FundEntryType.EXPENDITURE, amount_cents: 25_000 }),
    ])

    expect(r.awarded_cents).toBe(100_000)
    expect(r.received_cents).toBe(60_000)
    expect(r.spent_cents).toBe(25_000)
    // Promised but not yet in hand.
    expect(r.receivable_cents).toBe(40_000)
    // Still available to commit against the award.
    expect(r.unspent_award_cents).toBe(75_000)
    // Cash actually on hand right now.
    expect(r.cash_available_cents).toBe(35_000)
  })

  it("counts a return against both the award and the cash", () => {
    const r = rollupFund([
      entry({ entry_type: FundEntryType.AWARD, amount_cents: 10_000 }),
      entry({ entry_type: FundEntryType.RECEIPT, amount_cents: 10_000 }),
      entry({ entry_type: FundEntryType.EXPENDITURE, amount_cents: 4_000 }),
      entry({ entry_type: FundEntryType.RETURN, amount_cents: 6_000 }),
    ])

    expect(r.unspent_award_cents).toBe(0)
    expect(r.cash_available_cents).toBe(0)
  })

  it("treats a negative row as a reversing entry of its own type", () => {
    const r = rollupFund([
      entry({ entry_type: FundEntryType.EXPENDITURE, amount_cents: 5_000 }),
      entry({ entry_type: FundEntryType.EXPENDITURE, amount_cents: -5_000 }),
    ])
    expect(r.spent_cents).toBe(0)
  })

  it("does not clamp a fund that reads negative", () => {
    // A reversal with no matching spend should look wrong, not look empty.
    const r = rollupFund([
      entry({ entry_type: FundEntryType.EXPENDITURE, amount_cents: -5_000 }),
    ])
    expect(r.spent_cents).toBe(-5_000)
  })

  it("ignores an unknown entry type rather than misfiling it", () => {
    const r = rollupFund([
      entry({ entry_type: FundEntryType.AWARD, amount_cents: 1_000 }),
      entry({ entry_type: "pledge", amount_cents: 9_999 }),
    ])
    expect(r.awarded_cents).toBe(1_000)
    expect(r.entry_count).toBe(2)
  })

  it("coerces stored bigNumber strings", () => {
    const r = rollupFund([
      entry({ entry_type: FundEntryType.AWARD, amount_cents: "2500" }),
    ])
    expect(r.awarded_cents).toBe(2500)
  })
})

describe("restriction predicates", () => {
  it("identifies purpose restriction", () => {
    expect(isPurposeRestricted(FundRestriction.PURPOSE)).toBe(true)
    expect(isPurposeRestricted(FundRestriction.PURPOSE_AND_TIME)).toBe(true)
    expect(isPurposeRestricted(FundRestriction.TIME)).toBe(false)
    expect(isPurposeRestricted(FundRestriction.UNRESTRICTED)).toBe(false)
  })

  it("identifies time restriction", () => {
    expect(isTimeRestricted(FundRestriction.TIME)).toBe(true)
    expect(isTimeRestricted(FundRestriction.PURPOSE_AND_TIME)).toBe(true)
    expect(isTimeRestricted(FundRestriction.PURPOSE)).toBe(false)
  })
})

describe("isWithinSpendPeriod", () => {
  const windowed = terms({
    spend_from: "2026-01-01T00:00:00Z",
    spend_until: "2026-12-31T00:00:00Z",
  })

  it("accepts a date inside the window", () => {
    expect(isWithinSpendPeriod(windowed, "2026-06-01T00:00:00Z")).toBe(true)
  })

  it("rejects dates on either side", () => {
    expect(isWithinSpendPeriod(windowed, "2025-12-31T00:00:00Z")).toBe(false)
    expect(isWithinSpendPeriod(windowed, "2027-01-01T00:00:00Z")).toBe(false)
  })

  it("is unbounded where a bound is null", () => {
    const openEnded = terms({ spend_from: "2026-01-01T00:00:00Z", spend_until: null })
    expect(isWithinSpendPeriod(openEnded, "2099-01-01T00:00:00Z")).toBe(true)
  })

  it("treats a missing date as unverifiable, not as fine", () => {
    expect(isWithinSpendPeriod(windowed, null)).toBe(false)
    expect(isWithinSpendPeriod(windowed, "not-a-date")).toBe(false)
  })
})

describe("spendHeadroomCents", () => {
  it("is the unspent award when the limit is enforced", () => {
    const rollup = rollupFund([
      entry({ entry_type: FundEntryType.AWARD, amount_cents: 10_000 }),
      entry({ entry_type: FundEntryType.EXPENDITURE, amount_cents: 3_000 }),
    ])
    expect(spendHeadroomCents(terms(), rollup)).toBe(7_000)
  })

  it("is null when the fund does not enforce a limit", () => {
    const rollup = rollupFund([])
    expect(spendHeadroomCents(terms({ enforce_spend_limit: false }), rollup)).toBeNull()
  })
})

describe("checkCompliance", () => {
  it("passes a clean unrestricted fund", () => {
    expect(
      checkCompliance(terms(), [
        entry({ entry_type: FundEntryType.AWARD, amount_cents: 10_000 }),
        entry({ entry_type: FundEntryType.EXPENDITURE, amount_cents: 4_000 }),
      ])
    ).toEqual([])
  })

  it("flags spending past the award", () => {
    const v = checkCompliance(terms(), [
      entry({ entry_type: FundEntryType.AWARD, amount_cents: 10_000 }),
      entry({ entry_type: FundEntryType.EXPENDITURE, amount_cents: 12_000 }),
    ])
    expect(v.map((x) => x.code)).toContain("overspent")
    expect(v.find((x) => x.code === "overspent")?.amount_cents).toBe(2_000)
  })

  it("flags receiving more than was awarded, as a warning not an error", () => {
    const v = checkCompliance(terms(), [
      entry({ entry_type: FundEntryType.AWARD, amount_cents: 10_000 }),
      entry({ entry_type: FundEntryType.RECEIPT, amount_cents: 11_000 }),
    ])
    const found = v.find((x) => x.code === "over_received")
    expect(found?.severity).toBe("warning")
  })

  it("flags a spend on the wrong program", () => {
    const v = checkCompliance(
      terms({
        restriction: FundRestriction.PURPOSE,
        designated_program_id: "prog_meals",
      }),
      [
        entry({ entry_type: FundEntryType.AWARD, amount_cents: 10_000 }),
        entry({ id: "ft_bad", amount_cents: 1_000, program_id: "prog_admin" }),
      ]
    )
    const found = v.find((x) => x.code === "off_purpose")
    expect(found?.severity).toBe("error")
    expect(found?.transaction_id).toBe("ft_bad")
  })

  it("accepts a spend on the designated program", () => {
    const v = checkCompliance(
      terms({
        restriction: FundRestriction.PURPOSE,
        designated_program_id: "prog_meals",
      }),
      [
        entry({ entry_type: FundEntryType.AWARD, amount_cents: 10_000 }),
        entry({ amount_cents: 1_000, program_id: "prog_meals" }),
      ]
    )
    expect(v).toEqual([])
  })

  it("warns on an untagged spend from a purpose-restricted fund", () => {
    // Not provably wrong, but not verifiable either — which is what fails an audit.
    const v = checkCompliance(
      terms({
        restriction: FundRestriction.PURPOSE,
        designated_program_id: "prog_meals",
      }),
      [
        entry({ entry_type: FundEntryType.AWARD, amount_cents: 10_000 }),
        entry({ amount_cents: 1_000, program_id: null }),
      ]
    )
    const found = v.find((x) => x.code === "untagged_spend")
    expect(found?.severity).toBe("warning")
  })

  it("does not apply the purpose test when the fund names no program", () => {
    const v = checkCompliance(
      terms({ restriction: FundRestriction.PURPOSE, designated_program_id: null }),
      [
        entry({ entry_type: FundEntryType.AWARD, amount_cents: 10_000 }),
        entry({ amount_cents: 1_000, program_id: "anything" }),
      ]
    )
    expect(v).toEqual([])
  })

  it("flags a spend outside the permitted period", () => {
    const v = checkCompliance(
      terms({
        restriction: FundRestriction.TIME,
        spend_from: "2026-01-01T00:00:00Z",
        spend_until: "2026-03-31T00:00:00Z",
      }),
      [
        entry({ entry_type: FundEntryType.AWARD, amount_cents: 10_000 }),
        entry({ amount_cents: 1_000, occurred_at: "2026-06-01T00:00:00Z" }),
      ]
    )
    expect(v.map((x) => x.code)).toContain("out_of_period")
  })

  it("flags any spend against a permanently restricted corpus", () => {
    const v = checkCompliance(terms({ restriction: FundRestriction.PERMANENT }), [
      entry({ entry_type: FundEntryType.AWARD, amount_cents: 10_000 }),
      entry({ amount_cents: 1_000 }),
    ])
    expect(v.map((x) => x.code)).toContain("permanent_corpus_spent")
  })

  it("reports every violation at once, not just the first", () => {
    // A reconciliation needs the full list to work from.
    const v = checkCompliance(
      terms({
        restriction: FundRestriction.PURPOSE_AND_TIME,
        designated_program_id: "prog_meals",
        spend_from: "2026-01-01T00:00:00Z",
        spend_until: "2026-03-31T00:00:00Z",
      }),
      [
        entry({ entry_type: FundEntryType.AWARD, amount_cents: 1_000 }),
        entry({
          amount_cents: 5_000,
          program_id: "prog_admin",
          occurred_at: "2026-09-01T00:00:00Z",
        }),
      ]
    )
    expect(v.map((x) => x.code).sort()).toEqual([
      "off_purpose",
      "out_of_period",
      "overspent",
    ])
  })

  it("does not treat a reversing entry as breaking intent", () => {
    // Undoing a bad spend must not itself register as a second bad spend.
    const v = checkCompliance(
      terms({
        restriction: FundRestriction.PURPOSE,
        designated_program_id: "prog_meals",
      }),
      [
        entry({ entry_type: FundEntryType.AWARD, amount_cents: 10_000 }),
        entry({ amount_cents: -1_000, program_id: "prog_admin" }),
      ]
    )
    expect(v).toEqual([])
  })
})

// ── Settlement citation ───────────────────────────────────────────────────


describe("hasSettlementCitation", () => {
  it("accepts a hawala ledger entry reference", () => {
    expect(
      hasSettlementCitation({ reference_type: SETTLEMENT_REFERENCE_TYPE, reference_id: "hle_1" })
    ).toBe(true)
  })

  it("rejects a missing id, an empty id, and any other reference type", () => {
    expect(hasSettlementCitation({ reference_type: SETTLEMENT_REFERENCE_TYPE, reference_id: null })).toBe(false)
    expect(hasSettlementCitation({ reference_type: SETTLEMENT_REFERENCE_TYPE, reference_id: "" })).toBe(false)
    expect(hasSettlementCitation({ reference_type: "order", reference_id: "hle_1" })).toBe(false)
    expect(hasSettlementCitation({})).toBe(false)
  })
})

describe("settlementHeadroomCents", () => {
  it("is what the settlement moved less what is already attributed", () => {
    expect(settlementHeadroomCents(20_000, 4_500)).toBe(15_500)
  })

  it("is not clamped, so an over-cited settlement reads negative", () => {
    expect(settlementHeadroomCents(20_000, 21_000)).toBe(-1_000)
  })
})

describe("checkCompliance — uncited_spend", () => {
  const cited = { reference_type: SETTLEMENT_REFERENCE_TYPE, reference_id: "hle_1" }

  it("flags a spend with no settlement citation", () => {
    const v = checkCompliance(terms(), [
      entry({ entry_type: FundEntryType.AWARD, amount_cents: 10_000 }),
      entry({ id: "ft_legacy", amount_cents: 1_000, reference_type: null, reference_id: null }),
    ])
    const found = v.find((x) => x.code === "uncited_spend")
    expect(found?.severity).toBe("error")
    expect(found?.transaction_id).toBe("ft_legacy")
  })

  it("flags an uncited reversal too", () => {
    const v = checkCompliance(terms(), [
      entry({ entry_type: FundEntryType.AWARD, amount_cents: 10_000 }),
      entry({ amount_cents: -1_000, reference_type: null, reference_id: null }),
    ])
    expect(v.map((x) => x.code)).toContain("uncited_spend")
  })

  it("passes a cited spend", () => {
    const v = checkCompliance(terms(), [
      entry({ entry_type: FundEntryType.AWARD, amount_cents: 10_000 }),
      entry({ amount_cents: 1_000, ...cited }),
    ])
    expect(v).toEqual([])
  })

  it("does not care what a non-expenditure row references", () => {
    const v = checkCompliance(terms(), [
      entry({ entry_type: FundEntryType.AWARD, amount_cents: 10_000, reference_type: null, reference_id: null }),
    ])
    expect(v).toEqual([])
  })

  it("does not ask non-expenditure movements to cite anything", () => {
    const v = checkCompliance(terms(), [
      entry({ entry_type: FundEntryType.AWARD, amount_cents: 10_000 }),
      entry({ entry_type: FundEntryType.RECEIPT, amount_cents: 10_000 }),
      entry({ entry_type: FundEntryType.RETURN, amount_cents: 1_000 }),
    ])
    expect(v).toEqual([])
  })
})
