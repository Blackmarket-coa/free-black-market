import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { CREATOR_PROGRAM_MODULE } from "../../../../../modules/creator-program"
import CreatorProgramService from "../../../../../modules/creator-program/service"

/**
 * GET /v1/admin/marketplace/programs
 *
 * Admin oversight: list all programs across all vendors.
 * Filters: ?status=, ?vendor_id=, ?program_type=, ?limit=, ?offset=
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const limit = Math.min(
    Math.max(parseInt((req.query.limit as string) || "50", 10) || 50, 1),
    200
  )
  const offset = Math.max(parseInt((req.query.offset as string) || "0", 10) || 0, 0)

  const filter: Record<string, unknown> = {}
  if (req.query.status) filter.status = req.query.status as string
  if (req.query.vendor_id) filter.vendor_id = req.query.vendor_id as string
  if (req.query.program_type) filter.program_type = req.query.program_type as string

  const service = req.scope.resolve<CreatorProgramService>(CREATOR_PROGRAM_MODULE)
  const programs = await service.listCreatorPrograms(filter, {
    take: limit,
    skip: offset,
    order: { created_at: "DESC" } as const,
  })

  return res.status(200).json({ programs, limit, offset })
}
