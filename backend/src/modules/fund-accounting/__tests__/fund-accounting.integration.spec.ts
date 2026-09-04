import { moduleIntegrationTestRunner } from "@medusajs/test-utils"
import { FUND_ACCOUNTING_MODULE } from ".."
import FundAccountingModuleService, { type VerifiedSettlement } from "../service"
import { Fund, FundTransaction } from "../models"
import { FundRestriction } from "../models/fund"
import { FundEntryType } from "../models/fund-transaction"
import { SETTLEMENT_REFERENCE_TYPE } from "../fund-math"

/**
 * Real-Postgres coverage for the fund guards.
 *
 * Two of them read persisted history, and against a real database that is a
 * test that the rows a guard reads are the rows previous calls wrote:
 *
 * - the overspend guard, including a negative reversing entry that is what
 *   makes the second attempt below succeed;
 * - the per-settlement cap, which sums attribution across *every* fund the
 *   seller holds — the query a stubbed repository can only pretend to run.
 *
 * The settlement verifier is stubbed: this runner has no hawala module, and
 * what is under test is what fund-accounting does with a verified settlement,
 * not how the route finds one.
 *
 * Requires a database — run with:
 *   TEST_TYPE=integration:modules yarn test:integration:modules \
 *     src/modules/fund-accounting/__tests__/fund-accounting.integration.spec.ts
 *
 * Intentionally NOT a *.unit.spec.ts so the DB-less unit suite skips it.
 */
moduleIntegrationTestRunner<FundAccountingModuleService>({
  moduleName: FUND_ACCOUNTING_MODULE,
  resolve: "./src/modules/fund-accounting",
  moduleModels: [Fund, FundTransaction],
  testSuite: ({ service }) => {
    const unique = () => Math.random().toString(36).slice(2, 8)

    const SETTLEMENT: VerifiedSettlement = {
      id: "hle_it",
      amount_cents: 20_000,
      currency_code: "USD",
      settled: true,
    }
    const deps = {
      verifySettlement: async (id: string) => (id === SETTLEMENT.id ? SETTLEMENT : null),
    }
    const cite = { reference_type: SETTLEMENT_REFERENCE_TYPE, reference_id: SETTLEMENT.id }

    async function openFund(sellerId: string, over: Record<string, unknown> = {}) {
      const created = await (service as any).createFunds({
        seller_id: sellerId,
        name: "Local Food Purchase Assistance",
        code: `LFPA-${unique()}`,
        restriction: FundRestriction.UNRESTRICTED,
        ...over,
      })
      const fund = Array.isArray(created) ? created[0] : created
      return fund.id as string
    }

    const move = (
      sellerId: string,
      fundId: string,
      entry_type: FundEntryType,
      amount_cents: number,
      extra: Record<string, unknown> = {}
    ) =>
      service.recordEntry(
        { seller_id: sellerId, fund_id: fundId, entry_type, amount_cents, ...extra },
        deps
      )

    describe("fund-accounting on a real database", () => {
      it("derives balances from persisted movements, never from the fund row", async () => {
        const sellerId = `sel_${unique()}`
        const fundId = await openFund(sellerId)

        await move(sellerId, fundId, FundEntryType.AWARD, 100_000)
        await move(sellerId, fundId, FundEntryType.RECEIPT, 60_000)
        await move(sellerId, fundId, FundEntryType.EXPENDITURE, 15_000, cite)

        const report = await service.getFundReport(sellerId, fundId)
        expect(report.rollup.awarded_cents).toBe(100_000)
        expect(report.rollup.received_cents).toBe(60_000)
        expect(report.rollup.spent_cents).toBe(15_000)
        expect(report.rollup.receivable_cents).toBe(40_000)
        expect(report.rollup.unspent_award_cents).toBe(85_000)
        expect(report.rollup.cash_available_cents).toBe(45_000)
        expect(report.violations).toEqual([])
      })

      it("refuses an overspend against real history, then allows it once reversed", async () => {
        const sellerId = `sel_${unique()}`
        const fundId = await openFund(sellerId)

        await move(sellerId, fundId, FundEntryType.AWARD, 10_000)
        await move(sellerId, fundId, FundEntryType.EXPENDITURE, 8_000, cite)

        // 8,000 spent of 10,000: a 5,000 spend must be refused.
        await expect(
          move(sellerId, fundId, FundEntryType.EXPENDITURE, 5_000, cite)
        ).rejects.toThrow(/exceeds the fund's unspent award/i)

        // A reversing entry of the same type gives the headroom back.
        await move(sellerId, fundId, FundEntryType.EXPENDITURE, -8_000, cite)
        await expect(
          move(sellerId, fundId, FundEntryType.EXPENDITURE, 5_000, cite)
        ).resolves.toBeDefined()

        const report = await service.getFundReport(sellerId, fundId)
        expect(report.rollup.spent_cents).toBe(5_000)
        expect(report.spend_headroom_cents).toBe(5_000)
      })

      it("caps attribution to one settlement across every fund the seller holds", async () => {
        // A $200 payment split between two grants: $120 + $60 is fine; the
        // next $30 would claim $210 of $200 and is refused. The sum the guard
        // reads spans both funds' persisted rows.
        const sellerId = `sel_${unique()}`
        const grantA = await openFund(sellerId)
        const grantB = await openFund(sellerId)
        await move(sellerId, grantA, FundEntryType.AWARD, 100_000)
        await move(sellerId, grantB, FundEntryType.AWARD, 100_000)

        await move(sellerId, grantA, FundEntryType.EXPENDITURE, 12_000, cite)
        await move(sellerId, grantB, FundEntryType.EXPENDITURE, 6_000, cite)
        await expect(service.getCitedCents(sellerId, SETTLEMENT.id)).resolves.toBe(18_000)

        await expect(
          move(sellerId, grantB, FundEntryType.EXPENDITURE, 3_000, cite)
        ).rejects.toThrow(/exceeds the settlement/i)

        // Another seller citing the same settlement id is a different ledger
        // and must not count against this one.
        const other = `sel_${unique()}`
        const otherFund = await openFund(other)
        await move(other, otherFund, FundEntryType.AWARD, 100_000)
        await expect(
          move(other, otherFund, FundEntryType.EXPENDITURE, 20_000, cite)
        ).resolves.toBeDefined()
        await expect(service.getCitedCents(sellerId, SETTLEMENT.id)).resolves.toBe(18_000)
      })

      it("refuses an uncited spend and never writes it", async () => {
        const sellerId = `sel_${unique()}`
        const fundId = await openFund(sellerId)
        await move(sellerId, fundId, FundEntryType.AWARD, 10_000)

        await expect(
          move(sellerId, fundId, FundEntryType.EXPENDITURE, 1_000)
        ).rejects.toThrow(/must cite the settlement/i)

        const entries = await service.listEntries(sellerId, fundId)
        expect(entries.map((e) => e.entry_type)).toEqual([FundEntryType.AWARD])
      })

      it("surfaces an off-purpose spend rather than refusing it", async () => {
        const sellerId = `sel_${unique()}`
        const fundId = await openFund(sellerId, {
          restriction: FundRestriction.PURPOSE,
          designated_program_id: "prog_meals",
        })
        await move(sellerId, fundId, FundEntryType.AWARD, 10_000)
        // Purpose is reported, not refused: the guards block money-losing
        // writes, and a wrong program tag is a finding for reconciliation.
        await move(sellerId, fundId, FundEntryType.EXPENDITURE, 1_000, {
          ...cite,
          program_id: "prog_admin",
        })

        const report = await service.getFundReport(sellerId, fundId)
        expect(report.violations.map((v) => v.code)).toEqual(["off_purpose"])
      })

      it("never lets one seller read or spend another seller's fund", async () => {
        const fundId = await openFund(`sel_${unique()}`)
        const intruder = `sel_${unique()}`

        await expect(service.getFundReport(intruder, fundId)).rejects.toThrow(/not found/i)
        await expect(
          move(intruder, fundId, FundEntryType.RECEIPT, 1)
        ).rejects.toThrow(/not found/i)
      })
    })
  },
})
