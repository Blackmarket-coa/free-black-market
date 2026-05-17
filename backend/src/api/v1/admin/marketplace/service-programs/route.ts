import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SERVICE_PROGRAM_MODULE } from "../../../../../modules/service-program"
import type ServiceProgramService from "../../../../../modules/service-program/service"

/**
 * GET /v1/admin/marketplace/service-programs
 *
 * Filters: ?status=, ?vendor_id=, ?service_category=, ?program_type=,
 *         ?limit=, ?offset=
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
  if (req.query.service_category)
    filter.service_category = req.query.service_category as string
  if (req.query.program_type) filter.program_type = req.query.program_type as string

  const service = req.scope.resolve<ServiceProgramService>(SERVICE_PROGRAM_MODULE)
  const programs = await service.listServicePrograms(filter, {
    take: limit,
    skip: offset,
    order: { created_at: "DESC" } as any,
  })
  return res.status(200).json({ programs, limit, offset })
}
