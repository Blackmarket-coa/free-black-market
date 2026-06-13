import { createLogger } from "../../../../../shared/logger"
const log = createLogger("api/store/collective/buyer-networks/[id]")
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { BUYER_NETWORK_MODULE } from "../../../../../modules/buyer-network"
import BuyerNetworkModuleService from "../../../../../modules/buyer-network/service"

// GET /store/collective/buyer-networks/:id
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params

  try {
    const networkService = req.scope.resolve<BuyerNetworkModuleService>(
      BUYER_NETWORK_MODULE
    )

    const details = await networkService.getNetworkDetails(id)
    res.json({ buyer_network: details })
  } catch (error: any) {
    log.error(`[GET buyer-networks/${id}] Error:`, error.message)
    res.status(error.message.includes("not found") ? 404 : 500).json({
      error: error.message,
    })
  }
}
