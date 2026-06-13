import { createLogger } from "../../../../shared/logger"
const log = createLogger("api/admin/collective/demand-pools")
import { z } from "zod"
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { DEMAND_POOL_MODULE } from "../../../../modules/demand-pool"
import DemandPoolModuleService from "../../../../modules/demand-pool/service"

const listSchema = z.object({
  status: z.string().optional(),
  category: z.string().optional(),
  creator_id: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
  offset: z.coerce.number().min(0).default(0),
})

// GET /admin/collective/demand-pools
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  try {
    const query = listSchema.parse(req.query)
    const demandPoolService = req.scope.resolve<DemandPoolModuleService>(
      DEMAND_POOL_MODULE
    )

    const filters: Record<string, unknown> = {}
    if (query.status) filters.status = query.status
    if (query.category) filters.category = query.category
    if (query.creator_id) filters.creator_id = query.creator_id

    const [posts, count] = await demandPoolService.listAndCountDemandPosts(
      filters,
      {
        skip: query.offset,
        take: query.limit,
        order: { created_at: "DESC" },
      }
    )

    res.json({
      demand_pools: posts,
      count,
      offset: query.offset,
      limit: query.limit,
    })
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: error.issues })
    }
    log.error("[GET /admin/collective/demand-pools] Error:", error.message)
    res.status(500).json({ error: "Failed to retrieve demand pools" })
  }
}
