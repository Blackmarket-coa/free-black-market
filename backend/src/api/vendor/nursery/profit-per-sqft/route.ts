import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { NURSERY_VERTICAL_MODULE } from "../../../../modules/nursery-vertical"
import type NurseryVerticalModuleService from "../../../../modules/nursery-vertical/service"
import type { ProfitPerSqFtInput } from "../../../../modules/nursery-vertical/analytics/profit-per-sqft"
import { getSellerId } from "../../quests/_helpers"

/**
 * POST /vendor/nursery/profit-per-sqft  { rows: ProfitPerSqFtInput[] }
 *
 * Decision-support analytics, ranked by AnnualProfit/SqFt. Fully usable with no
 * quest enrolled. NOT lender-grade — its override/estimate inputs never enter a
 * quest packet's financial exhibits.
 */
export const POST = async (
  req: MedusaRequest<{ rows: ProfitPerSqFtInput[] }>,
  res: MedusaResponse
) => {
  const sellerId = getSellerId(req)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const rows = req.body?.rows
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ message: "rows[] is required" })
  }

  const service = req.scope.resolve<NurseryVerticalModuleService>(NURSERY_VERTICAL_MODULE)
  try {
    const ranking = service.rankProfitPerSqFt(rows)
    res.json({ ranking, count: ranking.length })
  } catch (e: any) {
    res.status(400).json({ message: e.message })
  }
}
