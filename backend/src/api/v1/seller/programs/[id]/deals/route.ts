import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { SellerAuthRequest } from "../../../../../middlewares/seller-context-v1"
import { CREATOR_PROGRAM_MODULE } from "../../../../../../modules/creator-program"
import CreatorProgramService from "../../../../../../modules/creator-program/service"

/**
 * GET /v1/seller/programs/:id/deals
 *
 * List deals on this program (vendor view). Supports `?status=` filter.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as SellerAuthRequest).seller_id
  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized", type: "unauthorized" })
  }
  const programId = (req.params as { id?: string })?.id
  if (!programId) {
    return res.status(400).json({ message: "Missing program id", type: "invalid_request" })
  }
  const service = req.scope.resolve<CreatorProgramService>(CREATOR_PROGRAM_MODULE)
  const programs = await service.listCreatorPrograms({ id: programId, vendor_id: sellerId })
  if (programs.length === 0) {
    return res.status(404).json({ message: "Program not found", type: "not_found" })
  }
  const filter: Record<string, unknown> = { program_id: programId }
  if (req.query.status) filter.status = req.query.status as string
  const deals = await service.listCreatorDeals(filter)
  return res.status(200).json({ deals })
}
