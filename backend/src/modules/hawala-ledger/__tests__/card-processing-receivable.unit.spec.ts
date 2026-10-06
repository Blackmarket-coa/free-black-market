import {
  CARD_PROCESSING_RECOVERY_LEG,
  CARD_PROCESSING_SHORTFALL_LEG,
  computeCardProcessingReceivable,
  isCardProcessingRecoveryLeg,
} from "../card-processing"

/**
 * The receivable is computed from rows, never stored (operator answer
 * 2026-10-06; `card-processing.ts`). Pure: what counts, what does not, and
 * how the next recovery's sequence number moves.
 */

const shortfall = (id: string, cents: number, over: Record<string, unknown> = {}) => ({
  id,
  entry_type: "ADJUSTMENT",
  status: "COMPLETED",
  amount: cents / 100,
  order_id: `order_${id}`,
  debit_account_id: "acc-processing",
  credit_account_id: "acc-escrow",
  metadata: { leg: CARD_PROCESSING_SHORTFALL_LEG, owed_by_account_id: "acc-seller", receivable: true },
  ...over,
})

const recovery = (shortfallId: string, cents: number, status: string, over: Record<string, unknown> = {}) => ({
  id: `rec_${shortfallId}_${cents}_${status}`,
  entry_type: "ADJUSTMENT",
  status,
  amount: cents / 100,
  debit_account_id: "acc-seller",
  credit_account_id: "acc-processing",
  metadata: { leg: CARD_PROCESSING_RECOVERY_LEG, recovers_entry_id: shortfallId, source_entry_id: "le_credit" },
  ...over,
})

describe("computeCardProcessingReceivable", () => {
  it("shortfalls owed by the account, less COMPLETED and in-flight recoveries; FAILED counts for nothing but moves the seq", () => {
    const r = computeCardProcessingReceivable("acc-seller", {
      shortfalls: [shortfall("a", 146), shortfall("b", 42)],
      recoveries: [
        recovery("a", 100, "COMPLETED"),
        recovery("a", 46, "FAILED"),
        recovery("a", 20, "PENDING"),
        recovery("b", 10, "REVERSED"),
      ],
    })
    expect(r.open).toEqual([
      { shortfall_id: "a", order_id: "order_a", owed_cents: 146, recovered_cents: 120, outstanding_cents: 26, created_at: null, next_seq: 3 },
      { shortfall_id: "b", order_id: "order_b", owed_cents: 42, recovered_cents: 0, outstanding_cents: 42, created_at: null, next_seq: 1 },
    ])
    expect(r.total_cents).toBe(68)
    expect(r.recovered_by_source_entry).toEqual({ le_credit: 120 })
  })

  it("ignores another account's shortfall, a non-COMPLETED shortfall, and recoveries from another account; clamps at zero; oldest first", () => {
    const r = computeCardProcessingReceivable("acc-seller", {
      shortfalls: [
        shortfall("late", 50, { created_at: "2026-10-06T12:00:00Z" }),
        shortfall("early", 30, { created_at: "2026-10-01T12:00:00Z" }),
        shortfall("other", 99, { metadata: { leg: CARD_PROCESSING_SHORTFALL_LEG, owed_by_account_id: "acc-else" } }),
        shortfall("failed", 99, { status: "FAILED" }),
        shortfall("over", 10),
      ],
      recoveries: [
        recovery("over", 15, "COMPLETED"),
        recovery("late", 50, "COMPLETED", { debit_account_id: "acc-else" }),
      ],
    })
    expect(r.open.map((o) => [o.shortfall_id, o.outstanding_cents])).toEqual([
      ["early", 30],
      ["late", 50],
    ])
    expect(r.total_cents).toBe(80)
  })

  it("recognises only the ADJUSTMENT recovery leg by its tag", () => {
    expect(isCardProcessingRecoveryLeg(recovery("a", 1, "COMPLETED"))).toBe(true)
    expect(isCardProcessingRecoveryLeg({ ...recovery("a", 1, "COMPLETED"), entry_type: "TRANSFER" })).toBe(false)
    expect(isCardProcessingRecoveryLeg(shortfall("a", 1))).toBe(false)
  })
})
