import { createLogger } from "../../../../shared/logger"
const log = createLogger("api/store/hawala/pools")
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { HAWALA_LEDGER_MODULE } from "../../../../modules/hawala-ledger"
import HawalaLedgerModuleService from "../../../../modules/hawala-ledger/service"

/**
 * GET /store/hawala/pools
 * List available investment pools for customers
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const hawalaService = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)

  const { producer_id, limit = "50", offset = "0" } = req.query

  try {
    const queryFilters: Record<string, any> = { status: "ACTIVE" }
    if (producer_id) queryFilters.producer_id = producer_id

    const pools = await hawalaService.listInvestmentPools(queryFilters)

    // Get balance and progress for each pool
    const poolsWithProgress = await Promise.all(
      pools.map(async (pool) => {
        const balance = await hawalaService.getAccountBalance(pool.ledger_account_id)
        const progress = Number(pool.target_amount) > 0
          ? (Number(pool.total_raised) / Number(pool.target_amount)) * 100
          : 0
        
        // Cast to any to access all model properties
        const p = pool as any

        return {
          id: p.id,
          name: p.name,
          description: p.description,
          producer_id: p.producer_id,
          target_amount: Number(p.target_amount),
          total_raised: Number(p.total_raised),
          minimum_investment: Number(p.minimum_investment),
          roi_type: p.roi_type,
          roi_rate: p.roi_rate || p.fixed_roi_rate || null,
          revenue_share_percentage: p.revenue_share_percentage,
          total_investors: p.total_investors,
          progress_percentage: Math.min(progress, 100),
          current_balance: balance.balance,
          fundraising_start: p.fundraising_start,
          fundraising_end: p.fundraising_end,
        }
      })
    )

    res.json({
      pools: poolsWithProgress,
      count: poolsWithProgress.length,
      limit: parseInt(limit as string),
      offset: parseInt(offset as string),
    })
  } catch (error) {
    log.error("Error listing pools:", error)
    res.status(500).json({ error: "Failed to retrieve investment pools" })
  }
}
