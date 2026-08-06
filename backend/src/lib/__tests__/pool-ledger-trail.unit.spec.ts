import { buildPoolLedgerTrail } from "../pool-ledger-trail"

const ESCROW = "acc_escrow"

const entry = (over: Record<string, unknown> = {}) => ({
  id: "le_1",
  entry_type: "TRANSFER",
  amount: 100,
  currency_code: "USD",
  description: "Escrow for demand pool dp_1",
  status: "COMPLETED",
  created_at: new Date("2026-08-01T00:00:00.000Z"),
  reference_id: "dp_1",
  debit_account_id: "acc_buyer",
  credit_account_id: ESCROW,
  settlement_batch_id: null,
  settled_at: null,
  ...over,
})

const build = (
  entries: Record<string, unknown>[],
  batches: Array<[string, Record<string, unknown>]> = [],
  bountyIds: string[] = []
) =>
  buildPoolLedgerTrail({
    demandPostId: "dp_1",
    escrowAccountId: ESCROW,
    entries: entries as never[],
    batchesById: new Map(batches as never),
    bountyIds: new Set(bountyIds),
  })

describe("buildPoolLedgerTrail", () => {
  describe("privacy", () => {
    it("never exposes account ids, balances-after or idempotency keys", () => {
      const trail = build([
        entry({
          debit_balance_after: 900,
          credit_balance_after: 100,
          idempotency_key: "demand-escrow-part_1",
        }),
      ])

      // What the pool did with its money is collective; what any one member
      // holds is not. Serialising the row would leak both.
      const serialised = JSON.stringify(trail)
      expect(serialised).not.toContain("acc_buyer")
      expect(serialised).not.toContain(ESCROW)
      expect(serialised).not.toContain("balance_after")
      expect(serialised).not.toContain("idempotency")
    })
  })

  describe("verification honesty", () => {
    it("marks an unsettled entry UNSETTLED", () => {
      const trail = build([entry()])

      expect(trail.entries[0].verification).toBe("UNSETTLED")
      expect(trail.entries[0].settlement).toBeNull()
      expect(trail.summary.unsettled_count).toBe(1)
      expect(trail.summary.anchored_count).toBe(0)
    })

    it("does not call a batched-but-unanchored entry verified", () => {
      const trail = build(
        [entry({ settlement_batch_id: "sb_1" })],
        [["sb_1", { id: "sb_1", batch_number: 7, status: "PROCESSING", stellar_tx_hash: null }]]
      )

      // A batch that has not landed on-chain proves nothing yet. Calling this
      // "verified" would be exactly the overclaim the feature exists to avoid.
      expect(trail.entries[0].verification).toBe("SETTLED_PENDING_ANCHOR")
      expect(trail.summary.settled_pending_anchor_count).toBe(1)
      expect(trail.summary.anchored_count).toBe(0)
    })

    it("marks ANCHORED only once a Stellar tx hash exists", () => {
      const trail = build(
        [
          entry({
            settlement_batch_id: "sb_1",
            settled_at: new Date("2026-08-02T00:00:00.000Z"),
          }),
        ],
        [
          [
            "sb_1",
            {
              id: "sb_1",
              batch_number: 7,
              status: "CONFIRMED",
              stellar_tx_hash: "abc123",
              stellar_ledger_sequence: 55,
              merkle_root: "deadbeef",
            },
          ],
        ]
      )

      expect(trail.entries[0].verification).toBe("ANCHORED")
      expect(trail.summary.anchored_count).toBe(1)
      // The anchor is the whole point: these are what a third party looks up.
      expect(trail.entries[0].settlement).toEqual({
        batch_number: 7,
        status: "CONFIRMED",
        stellar_tx_hash: "abc123",
        stellar_ledger_sequence: 55,
        merkle_root: "deadbeef",
        settled_at: "2026-08-02T00:00:00.000Z",
      })
    })
  })

  describe("arithmetic a reader can redo", () => {
    it("signs entries by direction relative to the escrow account", () => {
      const trail = build([
        entry({ id: "in_1", credit_account_id: ESCROW, debit_account_id: "acc_a", amount: 100 }),
        entry({ id: "in_2", credit_account_id: ESCROW, debit_account_id: "acc_b", amount: 50 }),
        entry({ id: "out_1", debit_account_id: ESCROW, credit_account_id: "acc_c", amount: 30 }),
      ])

      expect(trail.summary.total_in).toBe(150)
      expect(trail.summary.total_out).toBe(30)
      // Should match the escrow account's balance — that is the check.
      expect(trail.summary.net).toBe(120)
      expect(trail.summary.entry_count).toBe(3)
    })

    it("ignores entries touching neither side of the escrow", () => {
      const trail = build([
        entry({ id: "unrelated", debit_account_id: "acc_x", credit_account_id: "acc_y", amount: 999 }),
      ])

      expect(trail.summary.total_in).toBe(0)
      expect(trail.summary.total_out).toBe(0)
      expect(trail.summary.net).toBe(0)
    })

    it("produces a zero-sum net once everything is refunded", () => {
      const trail = build([
        entry({ id: "in_1", credit_account_id: ESCROW, amount: 100 }),
        entry({ id: "out_1", debit_account_id: ESCROW, credit_account_id: "acc_a", amount: 100 }),
      ])

      expect(trail.summary.net).toBe(0)
    })

    it("still lists entries when the pool has no escrow account", () => {
      const trail = buildPoolLedgerTrail({
        demandPostId: "dp_1",
        escrowAccountId: null,
        entries: [entry()] as never[],
        batchesById: new Map(),
        bountyIds: new Set(),
      })

      // No account to sign against, so the totals stay at zero rather than
      // guessing a direction.
      expect(trail.entries).toHaveLength(1)
      expect(trail.summary.net).toBe(0)
    })
  })

  describe("scoping", () => {
    it("labels bounty entries distinctly from pool entries", () => {
      const trail = build(
        [
          entry({ id: "pool_1", reference_id: "dp_1" }),
          entry({ id: "bounty_1", reference_id: "bnt_1" }),
        ],
        [],
        ["bnt_1"]
      )

      expect(trail.entries[0].scope).toBe("POOL")
      expect(trail.entries[1].scope).toBe("BOUNTY")
    })
  })

  it("handles an empty trail without dividing or guessing", () => {
    const trail = build([])

    expect(trail.entries).toEqual([])
    expect(trail.summary).toEqual(
      expect.objectContaining({
        entry_count: 0,
        total_in: 0,
        total_out: 0,
        net: 0,
        anchored_count: 0,
        unsettled_count: 0,
      })
    )
  })
})
