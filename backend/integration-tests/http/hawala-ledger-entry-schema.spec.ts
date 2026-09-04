import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { HAWALA_LEDGER_MODULE } from "../../src/modules/hawala-ledger"

jest.setTimeout(120 * 1000)

/**
 * Proves a ledger entry can be written on a migrated database.
 *
 * `hawala_ledger_entry` declared five columns its migrations never created;
 * `currency_code` carries a model default and so sat in every insert, which
 * meant the generated CRUD could not persist any entry on a database built
 * from the migrations. No existing spec caught it — none writes an entry, and
 * the module runners generate their schema from the model.
 *
 * This boots the real app (every migration, the fix included), writes an entry
 * that sets every previously-missing column, and reads it back. Kept separate
 * from the supply-chain flows so the signal survives if that spec's fixture
 * ever changes.
 */
medusaIntegrationTestRunner({
  inApp: true,
  testSuite: ({ getContainer }) => {
    describe("hawala ledger entry schema", () => {
      it("writes and reads an entry that uses every model column", async () => {
        const hawala = getContainer().resolve(HAWALA_LEDGER_MODULE) as any
        const suffix = Math.random().toString(36).slice(2)

        const debit = await hawala.createAccount({
          account_type: "SELLER_EARNINGS",
          owner_type: "SELLER",
          owner_id: `sel_${suffix}`,
        })
        const credit = await hawala.createAccount({
          account_type: "SETTLEMENT",
          owner_type: "PLATFORM",
          owner_id: `platform_${suffix}`,
        })

        const settledAt = new Date("2026-09-01T00:00:00Z")
        const created = await hawala.createLedgerEntries({
          debit_account_id: debit.id,
          credit_account_id: credit.id,
          amount: 12.34,
          currency_code: "USD",
          entry_type: "WITHDRAWAL",
          status: "SETTLED",
          settlement_batch_id: `batch_${suffix}`,
          settled_at: settledAt,
          debit_balance_after: 87.66,
          credit_balance_after: 12.34,
          description: "schema probe",
        })
        const row = Array.isArray(created) ? created[0] : created
        expect(row.id).toBeDefined()

        const [read] = await hawala.listLedgerEntries({ id: row.id })
        expect(read).toBeDefined()
        expect(read.currency_code).toBe("USD")
        expect(read.settlement_batch_id).toBe(`batch_${suffix}`)
        expect(new Date(read.settled_at).toISOString()).toBe(settledAt.toISOString())
        expect(Number(read.amount)).toBeCloseTo(12.34, 2)
        expect(Number(read.debit_balance_after)).toBeCloseTo(87.66, 2)
        expect(Number(read.credit_balance_after)).toBeCloseTo(12.34, 2)
      })
    })
  },
})
