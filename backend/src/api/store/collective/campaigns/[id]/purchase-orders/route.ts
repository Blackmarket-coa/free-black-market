import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { COLLECTIVE_CAMPAIGN_MODULE } from "../../../../../../modules/collective-campaign"
import CollectiveCampaignModuleService from "../../../../../../modules/collective-campaign/service"

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) {
    return error.message
  }

  if (typeof error === "string") {
    return error
  }

  return "Unknown error"
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const vendorId = (req as any).auth_context?.actor_id
    if (!vendorId) {
      return res.status(401).json({ error: "Unauthorized" })
    }

    const service = req.scope.resolve<CollectiveCampaignModuleService>(COLLECTIVE_CAMPAIGN_MODULE)
    const [campaign] = await service.listCampaigns({ id: req.params.id })
    if (!campaign) {
      return res.status(404).json({ error: "Campaign not found" })
    }

    if (campaign.vendor_id !== vendorId) {
      return res.status(403).json({ error: "Forbidden" })
    }

    const purchaseOrders = await service.listPurchaseOrders({ campaign_id: req.params.id })
    return res.json({ purchase_orders: purchaseOrders })
  } catch (error: unknown) {
    return res.status(500).json({ error: getErrorMessage(error) })
  }
}
