import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { FUND_ACCOUNTING_MODULE } from "../../../../modules/fund-accounting"
import type FundAccountingModuleService from "../../../../modules/fund-accounting/service"
import { getSellerId } from "../../quests/_helpers"

/**
 * GET /vendor/funds/portfolio — every fund's report at once, for a
 * whole-organisation reconciliation rather than one grant at a time.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const sellerId = getSellerId(req)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const service = req.scope.resolve<FundAccountingModuleService>(
    FUND_ACCOUNTING_MODULE
  )
  const reports = await service.getPortfolioReport(sellerId)

  res.json({
    reports,
    count: reports.length,
    // Surfaced at the top so a reconciliation view does not have to scan.
    funds_with_violations: reports.filter((r) => r.violations.length > 0).length,
  })
}
