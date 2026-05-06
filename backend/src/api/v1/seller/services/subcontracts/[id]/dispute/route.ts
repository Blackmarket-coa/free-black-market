import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import type { SellerAuthRequest } from "../../../../../../middlewares/seller-context-v1"
import { ORDER_SUBCONTRACT_MODULE } from "../../../../../../../modules/order-subcontract"
import type OrderSubcontractService from "../../../../../../../modules/order-subcontract/service"
import { OrderSubcontractStatus } from "../../../../../../../modules/order-subcontract/models"
import { MARKETPLACE_WEBHOOKS_MODULE } from "../../../../../../../modules/marketplace-webhooks"
import type MarketplaceWebhooksService from "../../../../../../../modules/marketplace-webhooks/service"

const Schema = z.object({
  reason: z.string().min(2).max(2000),
})

/**
 * POST /v1/seller/services/subcontracts/:id/dispute
 *
 * Either party can dispute. Escrow stays frozen pending admin review;
 * admin handles resolution + escrow disposition through the admin
 * marketplace endpoints.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as SellerAuthRequest).seller_id
  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized", type: "unauthorized" })
  }
  const id = (req.params as { id?: string })?.id
  if (!id) {
    return res.status(400).json({ message: "Missing id", type: "invalid_request" })
  }
  const parsed = Schema.safeParse(req.body ?? {})
  if (!parsed.success) {
    return res.status(400).json({
      message: "Invalid dispute payload",
      type: "invalid_request",
      errors: parsed.error.flatten(),
    })
  }
  const service = req.scope.resolve<OrderSubcontractService>(ORDER_SUBCONTRACT_MODULE)
  const list = await service.listOrderSubcontracts({ id })
  const sub = list[0]
  if (!sub) {
    return res.status(404).json({ message: "Subcontract not found", type: "not_found" })
  }
  if (
    sub.parent_seller_id !== sellerId &&
    sub.subcontract_seller_id !== sellerId
  ) {
    return res.status(403).json({ message: "Not a party to this subcontract", type: "forbidden" })
  }
  if (
    sub.status === OrderSubcontractStatus.ACCEPTED_BY_PARENT ||
    sub.status === OrderSubcontractStatus.CANCELED
  ) {
    return res.status(409).json({
      message: `Cannot dispute subcontract in status ${sub.status}`,
      type: "conflict",
    })
  }
  const updated = await service.dispute({
    subcontractId: id,
    actorSellerId: sellerId,
    reason: parsed.data.reason,
  })
  try {
    const webhooks = req.scope.resolve<MarketplaceWebhooksService>(
      MARKETPLACE_WEBHOOKS_MODULE
    )
    const payload = {
      subcontract_id: id,
      raised_by: sellerId,
      reason: parsed.data.reason,
    }
    await webhooks.dispatch("subcontract.disputed", sub.parent_seller_id, payload)
    await webhooks.dispatch("subcontract.disputed", sub.subcontract_seller_id, payload)
  } catch (err) {
    console.error("[subcontract/dispute] webhook dispatch failed", err)
  }
  return res.status(200).json({ subcontract: updated })
}
