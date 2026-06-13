import { createLogger } from "../../../../../../../shared/logger"
const log = createLogger("api/v1/seller/services/programs/[id]/publish")
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { SellerAuthRequest } from "../../../../../../middlewares/seller-context-v1"
import { SERVICE_PROGRAM_MODULE } from "../../../../../../../modules/service-program"
import type ServiceProgramService from "../../../../../../../modules/service-program/service"
import { MARKETPLACE_WEBHOOKS_MODULE } from "../../../../../../../modules/marketplace-webhooks"
import type MarketplaceWebhooksService from "../../../../../../../modules/marketplace-webhooks/service"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as SellerAuthRequest).seller_id
  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized", type: "unauthorized" })
  }
  const programId = (req.params as { id?: string })?.id
  if (!programId) {
    return res.status(400).json({ message: "Missing program id", type: "invalid_request" })
  }

  const service = req.scope.resolve<ServiceProgramService>(SERVICE_PROGRAM_MODULE)
  const list = await service.listServicePrograms({ id: programId, vendor_id: sellerId })
  const program = list[0]
  if (!program) {
    return res.status(404).json({ message: "Program not found", type: "not_found" })
  }
  const updated = await service.publishProgram(programId)

  try {
    const webhooks = req.scope.resolve<MarketplaceWebhooksService>(MARKETPLACE_WEBHOOKS_MODULE)
    await webhooks.dispatch("service.program.published", sellerId, {
      program_id: programId,
      vendor_id: sellerId,
      title: program.title,
      service_category: program.service_category,
      program_type: program.program_type,
    })
  } catch (err) {
    log.error("[service-program/publish] webhook dispatch failed", err)
  }
  return res.status(200).json({ program: updated })
}
