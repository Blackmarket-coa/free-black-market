import { moduleIntegrationTestRunner } from "@medusajs/test-utils"
import { FUND_ACCOUNTING_MODULE } from ".."
import FundAccountingModuleService from "../service"
import { Fund, FundTransaction } from "../models"
import { FundRestriction } from "../models/fund"
import { FundEntryType } from "../models/fund-transaction"

/**
 * Real-Postgres coverage for the fund guards.
 *
 * The overspend guard reads the fund's persisted history and refuses a write
 * that would exceed it. With a stubbed repository that is a test of the
 * arithmetic; against a real database it is a test that the rows the guard
 * reads are the rows the previous calls wrote — including a negative reversing
 * entry, which is what makes the second attempt below succeed.
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

    async function openFund(over: Record<string, unknown> = {}) {
      const sellerId = `sel_${unique()}`
      const created = await (service as any).createFunds({
        seller_id: sellerId,
        name: "Local Food Purchase Assistance",
        code: `LFPA-${unique()}`,
        restriction: FundRestriction.UNRESTRICTED,
        ...over,
      })
      const fund = Array.isArray(created) ? created[0] : created
      return { sellerId, fundId: fund.id as string }
    }

    describe("fund-accounting on a real database", () => {
      it("derives balances from persisted movements, never from the fund row", async () => {
        const { sellerId, fundId } = await openFund()

        await service.recordEntry({
          seller_id: sellerId,
          fund_id: fundId,
          entry_type: FundEntryType.AWARD,
          amount_cents: 100_000,
        })
        await service.recordEntry({
          seller_id: sellerId,
          fund_id: fundId,
          entry_type: FundEntryType.RECEIPT,
          amount_cents: 60_000,
        })
        await service.recordEntry({
          seller_id: sellerId,
          fund_id: fundId,
          entry_type: FundEntryType.EXPENDITURE,
          amount_cents: 25_000,
        })

        const report = await service.getFundReport(sellerId, fundId)
        expect(report.rollup.awarded_cents).toBe(100_000)
        expect(report.rollup.received_cents).toBe(60_000)
        expect(report.rollup.spent_cents).toBe(25_000)
        expect(report.rollup.receivable_cents).toBe(40_000)
        expect(report.rollup.unspent_award_cents).toBe(75_000)
        expect(report.rollup.cash_available_cents).toBe(35_000)
        expect(report.violations).toEqual([])
      })

      it("refuses an overspend against real history, then allows it once reversed", async () => {
        const { sellerId, fundId } = await openFund()

        await service.recordEntry({
          seller_id: sellerId,
          fund_id: fundId,
          entry_type: FundEntryType.AWARD,
          amount_cents: 10_000,
        })
        await service.recordEntry({
          seller_id: sellerId,
          fund_id: fundId,
          entry_type: FundEntryType.EXPENDITURE,
          amount_cents: 8_000,
        })

        // 8,000 spent of 10,000: a 5,000 spend must be refused.
        await expect(
          service.recordEntry({
            seller_id: sellerId,
            fund_id: fundId,
            entry_type: FundEntryType.EXPENDITURE,
            amount_cents: 5_000,
          })
        ).rejects.toThrow(/exceeds the fund's unspent award/i)

        // A reversing entry of the same type gives the headroom back.
        await service.recordEntry({
          seller_id: sellerId,
          fund_id: fundId,
          entry_type: FundEntryType.EXPENDITURE,
          amount_cents: -8_000,
        })
        await expect(
          service.recordEntry({
            seller_id: sellerId,
            fund_id: fundId,
            entry_type: FundEntryType.EXPENDITURE,
            amount_cents: 5_000,
          })
        ).resolves.toBeDefined()

        const report = await service.getFundReport(sellerId, fundId)
        expect(report.rollup.spent_cents).toBe(5_000)
        expect(report.spend_headroom_cents).toBe(5_000)
      })

      it("surfaces an off-purpose spend written with force", async () => {
        const { sellerId, fundId } = await openFund({
          restriction: FundRestriction.PURPOSE,
          designated_program_id: "prog_meals",
        })
        await service.recordEntry({
          seller_id: sellerId,
          fund_id: fundId,
          entry_type: FundEntryType.AWARD,
          amount_cents: 10_000,
        })
        // Purpose is reported, not refused: the guards block money-losing
        // writes, and a wrong program tag is a finding for reconciliation.
        await service.recordEntry({
          seller_id: sellerId,
          fund_id: fundId,
          entry_type: FundEntryType.EXPENDITURE,
          amount_cents: 1_000,
          program_id: "prog_admin",
        })

        const report = await service.getFundReport(sellerId, fundId)
        const codes = report.violations.map((v) => v.code)
        expect(codes).toContain("off_purpose")
        expect(codes).not.toContain("overspent")
      })

      it("never lets one seller read or spend another seller's fund", async () => {
        const { fundId } = await openFund()
        const intruder = `sel_${unique()}`

        await expect(service.getFundReport(intruder, fundId)).rejects.toThrow(
          /not found/i
        )
        await expect(
          service.recordEntry({
            seller_id: intruder,
            fund_id: fundId,
            entry_type: FundEntryType.RECEIPT,
            amount_cents: 1,
          })
        ).rejects.toThrow(/not found/i)
      })
    })
  },
})
