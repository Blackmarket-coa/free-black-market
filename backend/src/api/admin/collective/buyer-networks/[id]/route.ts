import { createLogger } from "../../../../../shared/logger"
const log = createLogger("api/admin/collective/buyer-networks/[id]")
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { BUYER_NETWORK_MODULE } from "../../../../../modules/buyer-network"
import BuyerNetworkModuleService from "../../../../../modules/buyer-network/service"
import { NetworkStatus } from "../../../../../modules/buyer-network/models/buyer-network"

// GET /admin/collective/buyer-networks/:id
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const { id } = req.params

  try {
    const networkService = req.scope.resolve<BuyerNetworkModuleService>(
      BUYER_NETWORK_MODULE
    )

    const details = await networkService.getNetworkDetails(id)
    res.json({ buyer_network: details })
  } catch (error) {
    log.error(`[GET /admin/collective/buyer-networks/${id}] Error:`, error.message)
    res.status(error.message.includes("not found") ? 404 : 500).json({
      error: error.message,
    })
  }
}

// PATCH /admin/collective/buyer-networks/:id (admin update)
export async function PATCH(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const { id } = req.params

  try {
    const networkService = req.scope.resolve<BuyerNetworkModuleService>(
      BUYER_NETWORK_MODULE
    )

    const { action, member_id, ...updateData } = req.body as { action?: string; member_id?: string; [key: string]: unknown }

    if (action === "verify") {
      await networkService.updateBuyerNetworks({
        id,
        verified: true,
      })
      const [updated] = await networkService.listBuyerNetworks({ id })
      return res.json({ buyer_network: updated, message: "Network verified" })
    }

    if (action === "suspend") {
      await networkService.updateBuyerNetworks({
        id,
        status: NetworkStatus.SUSPENDED,
      })
      const [updated] = await networkService.listBuyerNetworks({ id })
      return res.json({ buyer_network: updated, message: "Network suspended" })
    }

    if (action === "approve_member" && member_id) {
      const member = await networkService.approveMember(id, member_id)
      return res.json({ member, message: "Member approved" })
    }

    // General update
    await networkService.updateBuyerNetworks({ id, ...updateData })
    const [updated] = await networkService.listBuyerNetworks({ id })
    res.json({ buyer_network: updated })
  } catch (error) {
    log.error(`[PATCH /admin/collective/buyer-networks/${id}] Error:`, error.message)
    res.status(400).json({ error: error.message })
  }
}
