import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { CREATOR_PROGRAM_MODULE } from "../../../../modules/creator-program"
import CreatorProgramService from "../../../../modules/creator-program/service"
import {
  CreatorProgramType,
} from "../../../../modules/creator-program/models"
import { PUBLIC_PROGRAM_TYPES, toPublicProgram } from "./public-program"

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
  const filtered = open.filter((p) => PUBLIC_PROGRAM_TYPES.includes(p.program_type))

  const slice = filtered.slice(offset, offset + limit)

  return res.status(200).json({
    programs: slice.map(toPublicProgram),
    limit,
    offset,
    total: filtered.length,
  })
}
