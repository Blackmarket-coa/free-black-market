import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { CREATOR_PROGRAM_MODULE } from "../../../../modules/creator-program"
import CreatorProgramService from "../../../../modules/creator-program/service"
import {
  CreatorProgramType,
} from "../../../../modules/creator-program/models"

/**
 * GET /v1/marketplace/programs
 *
 * Public discovery of `affiliate_open` and `engagement_pool` programs that
 * any creator can apply to. Filters: `?vendor_id=`, `?program_type=`,
 * `?product_id=`. Used by the storefront and Creator Studio "Find programs"
 * tab.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const limit = Math.min(
    Math.max(parseInt((req.query.limit as string) || "50", 10) || 50, 1),
    200
  )
  const offset = Math.max(parseInt((req.query.offset as string) || "0", 10) || 0, 0)

  const programType = req.query.program_type as string | undefined
  const vendorId = req.query.vendor_id as string | undefined
  const productId = req.query.product_id as string | undefined

  const service = req.scope.resolve<CreatorProgramService>(CREATOR_PROGRAM_MODULE)

  const open = await service.listOpenPrograms({
    vendorId,
    programType: programType as CreatorProgramType | undefined,
    productId,
  })

  // Only surface open-application program types in public listing
  const filtered = open.filter(
    (p) =>
      p.program_type === CreatorProgramType.AFFILIATE_OPEN ||
      p.program_type === CreatorProgramType.ENGAGEMENT_POOL ||
      p.program_type === CreatorProgramType.COMMISSION_BOOST
  )

  const slice = filtered.slice(offset, offset + limit)

  return res.status(200).json({
    programs: slice.map((p) => ({
      id: p.id,
      vendor_id: p.vendor_id,
      title: p.title,
      slug: p.slug,
      description: p.description,
      program_type: p.program_type,
      commission_percent: p.commission_percent,
      commission_flat_cents: p.commission_flat_cents,
      sponsorship_flat_cents: p.sponsorship_flat_cents,
      pool_total_cents: p.pool_total_cents,
      pool_period: p.pool_period,
      cookie_window_days: p.cookie_window_days,
      currency_code: p.currency_code,
      starts_at: p.starts_at,
      ends_at: p.ends_at,
      requires_kyc: p.requires_kyc,
      min_followers: p.min_followers,
      product_ids: p.product_ids ?? [],
    })),
    limit,
    offset,
    total: filtered.length,
  })
}
