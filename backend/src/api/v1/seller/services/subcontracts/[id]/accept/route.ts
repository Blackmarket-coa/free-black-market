import { createLogger } from "../../../../../../../shared/logger"
const log = createLogger("api/v1/seller/services/subcontracts/[id]/accept")
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { SellerAuthRequest } from "../../../../../../middlewares/seller-context-v1"
import { ORDER_SUBCONTRACT_MODULE } from "../../../../../../../modules/order-subcontract"
import type OrderSubcontractService from "../../../../../../../modules/order-subcontract/service"
import { MARKETPLACE_WEBHOOKS_MODULE } from "../../../../../../../modules/marketplace-webhooks"
import type MarketplaceWebhooksService from "../../../../../../../modules/marketplace-webhooks/service"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as SellerAuthRequest).seller_id
  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized", type: "unauthorized" })
  }
  const id = (req.params as { id?: string })?.id
  if (!id) {
    return res.status(400).json({ message: "Missing id", type: "invalid_request" })
  }
  const service = req.scope.resolve<OrderSubcontractService>(ORDER_SUBCONTRACT_MODULE)
  try {
    const sub = await service.acceptSubcontract({
      subcontractId: id,
      serviceSellerId: sellerId,
    })
    try {
      const webhooks = req.scope.resolve<MarketplaceWebhooksService>(
        MARKETPLACE_WEBHOOKS_MODULE
      )
      await webhooks.dispatch("subcontract.accepted", sellerId, {
        subcontract_id: id,
        accepted_by: sellerId,
      })
      await webhooks.dispatch("subcontract.accepted", sub.parent_seller_id, {
        subcontract_id: id,
        accepted_by: sellerId,
      })
    } catch (err) {
      log.error("[subcontract/accept] webhook dispatch failed", err)
    }
    return res.status(200).json({ subcontract: sub })
  } catch (err) {
    return res.status(409).json({ message: (err as Error).message, type: "conflict" })
  }
}
