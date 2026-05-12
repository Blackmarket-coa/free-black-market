import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ASSET_GRAPH_MODULE } from "../../../../modules/asset-graph"
import type AssetGraphService from "../../../../modules/asset-graph/service"

/**
 * GET /admin/asset-graph/instances
 *
 * Query params:
 *   manifest_slug         filter to one manifest's instances
 *   operator_member_id    filter to one operator
 *   state                 draft | active | paused | archived
 *   limit / offset        pagination
 *
 * Lists ProjectInstance rows. Each instance is the deployment of a
 * manifest in a specific place with a specific operator and member
 * set.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const service: any = req.scope.resolve(ASSET_GRAPH_MODULE)

  const filters: Record<string, unknown> = {}
  if (req.query.manifest_slug) filters.manifest_slug = req.query.manifest_slug
  if (req.query.operator_member_id) {
    filters.operator_member_id = req.query.operator_member_id
  }
  if (req.query.state) filters.state = req.query.state

  const limit = req.query.limit ? Number(req.query.limit) : 20
  const offset = req.query.offset ? Number(req.query.offset) : 0

  const instances = await (service as AssetGraphService).listProjectInstances(
    filters as any,
    { take: limit, skip: offset } as any
  )

  return res.json({
    instances,
    count: Array.isArray(instances) ? instances.length : 0,
    limit,
    offset,
  })
}
