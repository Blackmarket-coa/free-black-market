import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { COLLECTIVE_CAMPAIGN_MODULE } from "../../../../../../modules/collective-campaign"
import CollectiveCampaignModuleService from "../../../../../../modules/collective-campaign/service"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const service = req.scope.resolve<CollectiveCampaignModuleService>(COLLECTIVE_CAMPAIGN_MODULE)
  const purchaseOrders = await service.listPurchaseOrders({ campaign_id: req.params.id })
  return res.json({ purchase_orders: purchaseOrders })
}
