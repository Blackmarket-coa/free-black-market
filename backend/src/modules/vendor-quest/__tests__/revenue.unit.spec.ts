/**
 * Income reconciliation: the revenue summary that feeds a lender packet's income
 * statement must equal the ledger. `computeRevenueSummary` counts ONLY
 * CREDIT + PURCHASE entries — the same filter `hawala-ledger`'s own vendor
 * dashboard uses — so a packet figure is always reproducible from the ledger and
 * we never create a parallel un-reconciled total.
 */
import { computeRevenueSummary, type LedgerHistoryEntry } from "../substrate/revenue"

const asOf = new Date("2026-07-01T00:00:00.000Z")

function entry(partial: Partial<LedgerHistoryEntry>): LedgerHistoryEntry {
  return {
    direction: "CREDIT",
    entry_type: "PURCHASE",
    signed_amount: 0,
    created_at: "2026-06-01T00:00:00.000Z",
    status: "COMPLETED",
    ...partial,
  }
}

describe("computeRevenueSummary reconciles to ledger", () => {
  it("lifetime revenue equals the sum of CREDIT+PURCHASE entries", () => {
    const entries = [
      entry({ signed_amount: 100 }),
      entry({ signed_amount: 250.5 }),
      entry({ signed_amount: 49.5 }),
    ]
    const expectedTotal = 100 + 250.5 + 49.5
    const summary = computeRevenueSummary(entries, { asOf })
    expect(summary.lifetime_revenue).toBe(expectedTotal)
    // Reconciliation: the packet figure IS the ledger sum, to the cent.
    const ledgerSum = entries.reduce((s, e) => s + (e.signed_amount ?? 0), 0)
    expect(summary.lifetime_revenue).toBeCloseTo(ledgerSum, 2)
  })

  it("excludes refunds, fees, and debits (non CREDIT+PURCHASE)", () => {
    const entries = [
      entry({ signed_amount: 200 }), // counted
      entry({ entry_type: "REFUND", signed_amount: -50 }), // excluded
      entry({ entry_type: "FEE", signed_amount: -10 }), // excluded
      entry({ direction: "DEBIT", entry_type: "PURCHASE", signed_amount: -30 }), // excluded
    ]
    const summary = computeRevenueSummary(entries, { asOf })
    expect(summary.lifetime_revenue).toBe(200)
  })

  it("buckets monthly cash-flow deterministically", () => {
    const entries = [
      entry({ signed_amount: 100, created_at: "2026-05-10T00:00:00Z" }),
      entry({ signed_amount: 200, created_at: "2026-05-20T00:00:00Z" }),
      entry({ signed_amount: 300, created_at: "2026-06-05T00:00:00Z" }),
    ]
    const summary = computeRevenueSummary(entries, { asOf })
    expect(summary.monthly).toEqual([
      { month: "2026-05", revenue: 300 },
      { month: "2026-06", revenue: 300 },
    ])
  })
})
