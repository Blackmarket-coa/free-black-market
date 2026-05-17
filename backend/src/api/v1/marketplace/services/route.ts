import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SERVICE_PROGRAM_MODULE } from "../../../../modules/service-program"
import type ServiceProgramService from "../../../../modules/service-program/service"
import {
  ServiceCategory,
  ServiceProgramType,
} from "../../../../modules/service-program/models"

/**
 * GET /v1/marketplace/services
 *
 * Public discovery of open service-marketplace bounties. Filters:
 *   ?service_category=apparel_press
 *   ?program_type=bounty_open|bounty_invite|fixed_contract|throughput_pool
 *   ?vendor_id=
 *   ?limit=&offset=
 *
 * Only `bounty_open` and `throughput_pool` programs are surfaced — others
 * are invite- or contract-only.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const limit = Math.min(
    Math.max(parseInt((req.query.limit as string) || "50", 10) || 50, 1),
    200
  )
  const offset = Math.max(parseInt((req.query.offset as string) || "0", 10) || 0, 0)

  const service = req.scope.resolve<ServiceProgramService>(SERVICE_PROGRAM_MODULE)

  const open = await service.listOpenPrograms({
    serviceCategory: req.query.service_category as ServiceCategory | undefined,
    programType: req.query.program_type as ServiceProgramType | undefined,
    vendorId: req.query.vendor_id as string | undefined,
  })

  const filtered = open.filter(
    (p: any) =>
      p.program_type === ServiceProgramType.BOUNTY_OPEN ||
      p.program_type === ServiceProgramType.THROUGHPUT_POOL
  )

  const slice = filtered.slice(offset, offset + limit)

  return res.status(200).json({
    programs: slice.map((p: any) => ({
      id: p.id,
      vendor_id: p.vendor_id,
      title: p.title,
      slug: p.slug,
      description: p.description,
      service_category: p.service_category,
      program_type: p.program_type,
      pricing_model: p.pricing_model,
      unit_price_cents: p.unit_price_cents,
      hourly_rate_cents: p.hourly_rate_cents,
      flat_price_cents: p.flat_price_cents,
      pool_total_cents: p.pool_total_cents,
      currency_code: p.currency_code,
      min_units: p.min_units,
      max_units: p.max_units,
      deadline_at: p.deadline_at,
      requires_kyc: p.requires_kyc,
    })),
    limit,
    offset,
    total: filtered.length,
  })
}
