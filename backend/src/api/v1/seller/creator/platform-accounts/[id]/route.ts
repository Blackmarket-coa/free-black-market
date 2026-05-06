import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { SellerAuthRequest } from "../../../../../middlewares/seller-context-v1"
import { CONTENT_PLATFORM_MODULE } from "../../../../../../modules/content-platform"
import type ContentPlatformService from "../../../../../../modules/content-platform/service"

export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as SellerAuthRequest).seller_id
  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized", type: "unauthorized" })
  }
  const id = (req.params as { id?: string })?.id
  if (!id) {
    return res.status(400).json({ message: "Missing id", type: "invalid_request" })
  }
  const cp = req.scope.resolve<ContentPlatformService>(CONTENT_PLATFORM_MODULE)
  const accounts = await cp.listPlatformAccounts({ id, creator_seller_id: sellerId })
  if (accounts.length === 0) {
    return res.status(404).json({ message: "Account not found", type: "not_found" })
  }
  const updated = await cp.revokeAccount(id)
  return res.status(200).json({ account: updated })
}
