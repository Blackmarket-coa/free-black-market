import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { CREATOR_ATTRIBUTION_MODULE } from "../../../../../modules/creator-attribution"
import CreatorAttributionService from "../../../../../modules/creator-attribution/service"

/**
 * GET /v1/admin/marketplace/attributions
 *
 * Moderation queue. Filter by ?status=pending|held|approved|paid|reversed|disqualified
 * and ?creator_seller_id=...
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const limit = Math.min(Math.max(parseInt((req.query.limit as string) || "50", 10) || 50, 1), 200)
  const offset = Math.max(parseInt((req.query.offset as string) || "0", 10) || 0, 0)

  const filter: Record<string, unknown> = {}
  if (req.query.status) filter.commission_status = req.query.status as string
  if (req.query.creator_seller_id) filter.creator_seller_id = req.query.creator_seller_id as string
  if (req.query.program_id) filter.program_id = req.query.program_id as string

  const service = req.scope.resolve<CreatorAttributionService>(
    CREATOR_ATTRIBUTION_MODULE
  )

  const attributions = await service.listOrderAttributions(filter, {
    take: limit,
    skip: offset,
    order: { attribution_decided_at: "DESC" } as const,
  })

  return res.status(200).json({ attributions, limit, offset })
}
