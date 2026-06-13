import { createLogger } from "../../../../../../shared/logger"
const log = createLogger("api/store/collective/buyer-networks/[id]/leaderboard")
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { BUYER_NETWORK_MODULE } from "../../../../../../modules/buyer-network"
import BuyerNetworkModuleService from "../../../../../../modules/buyer-network/service"

// GET /store/collective/buyer-networks/:id/leaderboard
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params
  const limit = parseInt(req.query.limit as string) || 20

  try {
    const networkService = req.scope.resolve<BuyerNetworkModuleService>(
      BUYER_NETWORK_MODULE
    )

    const leaderboard = await networkService.getNetworkLeaderboard(id, limit)
    res.json({ leaderboard })
  } catch (error: any) {
    log.error(`[GET leaderboard] Error:`, error.message)
    res.status(500).json({ error: "Failed to retrieve leaderboard" })
  }
}
