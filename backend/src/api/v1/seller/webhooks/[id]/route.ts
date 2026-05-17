import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { SellerAuthRequest } from "../../../../middlewares/seller-context-v1"
import { MARKETPLACE_WEBHOOKS_MODULE } from "../../../../../modules/marketplace-webhooks"
import type MarketplaceWebhooksService from "../../../../../modules/marketplace-webhooks/service"

export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as SellerAuthRequest).seller_id
  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized", type: "unauthorized" })
  }

  const service = req.scope.resolve<MarketplaceWebhooksService>(
    MARKETPLACE_WEBHOOKS_MODULE
  )

  const [sub] = await service.listWebhookSubscriptions({
    id: req.params.id,
    seller_id: sellerId,
  })
  if (!sub) {
    return res.status(404).json({ message: "Subscription not found", type: "not_found" })
  }

  await service.deleteWebhookSubscriptions(sub.id)
  return res.json({ id: sub.id, deleted: true })
}
