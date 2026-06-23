import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { SellerAuthRequest } from "../../../../middlewares/seller-context-v1"
import { CREATOR_PROGRAM_MODULE } from "../../../../../modules/creator-program"
import CreatorProgramService from "../../../../../modules/creator-program/service"

/**
 * GET /v1/seller/creator/deals
 *
 * List active and historical deals for the authenticated creator.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as SellerAuthRequest).seller_id
  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized", type: "unauthorized" })
  }

  const service = req.scope.resolve<CreatorProgramService>(CREATOR_PROGRAM_MODULE)
  const deals = await service.listCreatorDeals({ creator_seller_id: sellerId })

  // Hydrate each deal with program title for nicer display
  const programIds = Array.from(new Set(deals.map((d) => d.program_id)))
  const programs = programIds.length
    ? await service.listCreatorPrograms({ id: programIds })
    : []
  const programById = new Map(programs.map((p) => [p.id, p]))

  return res.status(200).json({
    deals: deals.map((d) => ({
      ...d,
      program_title: programById.get(d.program_id)?.title ?? null,
    })),
  })
}
