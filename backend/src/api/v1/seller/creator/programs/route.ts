import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { SellerAuthRequest } from "../../../../middlewares/seller-context-v1"
import { CREATOR_PROGRAM_MODULE } from "../../../../../modules/creator-program"
import CreatorProgramService from "../../../../../modules/creator-program/service"
import {
  CreatorProgramType,
  CreatorProgramStatus,
} from "../../../../../modules/creator-program/models"

/**
 * GET /v1/seller/creator/programs
 *
 * Lists programs visible to this creator: open public programs + programs
 * the creator has already applied to (regardless of decision) + active
 * deals. Frontend can split into tabs.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as SellerAuthRequest).seller_id
  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized", type: "unauthorized" })
  }

  const service = req.scope.resolve<CreatorProgramService>(CREATOR_PROGRAM_MODULE)

  const [openPrograms, myApplications, myDeals] = await Promise.all([
    service.listOpenPrograms(),
    service.listCreatorApplications({ creator_seller_id: sellerId }),
    service.listCreatorDeals({ creator_seller_id: sellerId }),
  ])

  const appProgramIds = new Set(myApplications.map((a: any) => a.program_id))

  return res.status(200).json({
    open: openPrograms
      .filter(
        (p: any) =>
          (p.program_type === CreatorProgramType.AFFILIATE_OPEN ||
            p.program_type === CreatorProgramType.ENGAGEMENT_POOL ||
            p.program_type === CreatorProgramType.COMMISSION_BOOST) &&
          !appProgramIds.has(p.id)
      )
      .map((p: any) => ({
        id: p.id,
        vendor_id: p.vendor_id,
        title: p.title,
        program_type: p.program_type,
        commission_percent: p.commission_percent,
        commission_flat_cents: p.commission_flat_cents,
        sponsorship_flat_cents: p.sponsorship_flat_cents,
        pool_total_cents: p.pool_total_cents,
        cookie_window_days: p.cookie_window_days,
        currency_code: p.currency_code,
        requires_kyc: p.requires_kyc,
        min_followers: p.min_followers,
        ends_at: p.ends_at,
      })),
    applications: myApplications,
    deals: myDeals,
  })
}
