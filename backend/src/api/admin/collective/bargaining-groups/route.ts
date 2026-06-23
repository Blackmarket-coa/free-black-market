import { createLogger } from "../../../../shared/logger"
const log = createLogger("api/admin/collective/bargaining-groups")
import { z } from "zod"
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { BARGAINING_MODULE } from "../../../../modules/bargaining"
import BargainingModuleService from "../../../../modules/bargaining/service"

const listSchema = z.object({
  status: z.string().optional(),
  category: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
  offset: z.coerce.number().min(0).default(0),
})

// GET /admin/collective/bargaining-groups
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  try {
    const query = listSchema.parse(req.query)
    const bargainingService = req.scope.resolve<BargainingModuleService>(
      BARGAINING_MODULE
    )

    const filters: Record<string, unknown> = {}
    if (query.status) filters.status = query.status
    if (query.category) filters.category = query.category

    const [groups, count] = await bargainingService.listAndCountBargainingGroups(
      filters,
      {
        skip: query.offset,
        take: query.limit,
        order: { created_at: "DESC" },
      }
    )

    res.json({
      bargaining_groups: groups,
      count,
      offset: query.offset,
      limit: query.limit,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: error.issues })
    }
    log.error("[GET /admin/collective/bargaining-groups] Error:", error.message)
    res.status(500).json({ error: "Failed to retrieve bargaining groups" })
  }
}
