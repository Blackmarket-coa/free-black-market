import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { FUND_ACCOUNTING_MODULE } from "../../../../../modules/fund-accounting"
import type FundAccountingModuleService from "../../../../../modules/fund-accounting/service"
import { getSellerId } from "../../../quests/_helpers"

/**
 * GET /vendor/funds/:id/report — the grant reconciliation view: balances plus
 * every way the fund's history breaks its donor's intent.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const sellerId = getSellerId(req)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const service = req.scope.resolve<FundAccountingModuleService>(
    FUND_ACCOUNTING_MODULE
  )

  try {
    const report = await service.getFundReport(sellerId, req.params.id)
    res.json({ report })
  } catch (e) {
    if (e instanceof MedusaError && e.type === MedusaError.Types.NOT_FOUND) {
      return res.status(404).json({ message: "Fund not found" })
    }
    throw e
  }
}
