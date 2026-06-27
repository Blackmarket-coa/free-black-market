import {
  getCreatorCreditBalance,
  listCreatorCreditTransactions,
} from "../creator-hub"

/**
 * Fake hawala-ledger service exposing just the two list methods the creator-hub
 * credit helpers use, backed by in-memory rows. Mirrors the in-memory-service
 * approach used elsewhere (e.g. marketplace-webhooks Blackout tests).
 */
function makeHawala(accounts: any[], entries: any[]) {
  return {
    listLedgerAccounts: async (filters: Record<string, any> = {}) =>
      accounts.filter((a) =>
        Object.entries(filters).every(([k, v]) => {
          if (v === undefined) return true
          if (Array.isArray(v)) return v.includes(a[k])
          return a[k] === v
        })
      ),
    listLedgerEntries: async (filters: Record<string, any> = {}) =>
      entries.filter((e) =>
        Object.entries(filters).every(([k, v]) => {
          if (v === undefined) return true
          if (Array.isArray(v)) return v.includes(e[k])
          return e[k] === v
        })
      ),
  } as any
}

const CCR_ACCOUNTS = [
  { id: "acc_ccr", owner_id: "sel_1", currency_code: "CCR", available_balance: 1800, pending_balance: 200 },
]
// Includes a non-CCR account that must be ignored by the CCR-scoped helpers.
const ALL_ACCOUNTS = [
  ...CCR_ACCOUNTS,
  { id: "acc_usd", owner_id: "sel_1", currency_code: "USD", available_balance: 5000, pending_balance: 0 },
]

const ENTRIES = [
  { id: "e1", credit_account_id: "acc_ccr", amount: 1000, entry_type: "TRANSFER", description: "tip from @ari", created_at: "2026-06-27T10:00:00Z", metadata: { room_id: "#main", blackout_event_id: "$tip1" } },
  { id: "e2", credit_account_id: "acc_ccr", amount: 800, entry_type: "COMMISSION", description: "membership", created_at: "2026-06-26T10:00:00Z" },
  { id: "e3", debit_account_id: "acc_ccr", amount: 500, entry_type: "WITHDRAWAL", description: "ACH", created_at: "2026-06-20T10:00:00Z" },
]

describe("creator-hub credit helpers", () => {
  it("sums CCR balance and lifetime-earned, ignoring non-CCR accounts", async () => {
    const hawala = makeHawala(ALL_ACCOUNTS, ENTRIES)
    const bal = await getCreatorCreditBalance(hawala, "sel_1")
    expect(bal.available_credits).toBe(1800)
    expect(bal.pending_credits).toBe(200)
    // lifetime = sum of incoming (credit) entries to CCR accounts: 1000 + 800
    expect(bal.lifetime_earned).toBe(1800)
  })

  it("returns a zeroed balance when the creator has no CCR wallet", async () => {
    const hawala = makeHawala([{ id: "acc_usd", currency_code: "USD", available_balance: 9 }], [])
    const bal = await getCreatorCreditBalance(hawala, "sel_1")
    expect(bal).toEqual({ available_credits: 0, pending_credits: 0, lifetime_earned: 0 })
  })

  it("signs transactions by direction and maps entry types, newest first", async () => {
    const hawala = makeHawala(ALL_ACCOUNTS, ENTRIES)
    const txns = await listCreatorCreditTransactions(hawala, "sel_1")

    expect(txns.map((t) => t.id)).toEqual(["e1", "e2", "e3"]) // newest first
    const tip = txns.find((t) => t.id === "e1")!
    expect(tip).toMatchObject({
      type: "tip",
      amount_credits: 1000,
      room: "#main",
      blackout_event_id: "$tip1",
    })
    const withdrawal = txns.find((t) => t.id === "e3")!
    expect(withdrawal.type).toBe("withdrawal")
    expect(withdrawal.amount_credits).toBe(-500) // debit-out is negative
  })

  it("respects the limit", async () => {
    const hawala = makeHawala(ALL_ACCOUNTS, ENTRIES)
    const txns = await listCreatorCreditTransactions(hawala, "sel_1", 1)
    expect(txns).toHaveLength(1)
    expect(txns[0].id).toBe("e1")
  })
})
