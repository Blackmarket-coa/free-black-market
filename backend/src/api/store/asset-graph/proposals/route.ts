import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ASSET_GRAPH_MODULE } from "../../../../modules/asset-graph"
import type AssetGraphService from "../../../../modules/asset-graph/service"

/**
 * GET /store/asset-graph/proposals
 *
 * Lists MatchProposals where the authenticated member is the
 * candidate operator. Filters by the auth context's actor_id —
 * other members' proposals aren't returned even if their ids are
 * known.
 *
 * Query params: manifest_slug, state, limit, offset.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const memberId = (req as any).auth_context?.actor_id
  if (!memberId) return res.status(401).json({ error: "Unauthorized" })

  const service: any = req.scope.resolve(ASSET_GRAPH_MODULE)

  const filters: Record<string, unknown> = { member_id: memberId }
  if (req.query.manifest_slug) filters.manifest_slug = req.query.manifest_slug
  if (req.query.state) filters.state = req.query.state

  const limit = req.query.limit ? Number(req.query.limit) : 20
  const offset = req.query.offset ? Number(req.query.offset) : 0

  const proposals = await (service as AssetGraphService).listMatchProposals(
    filters as any,
    { take: limit, skip: offset } as any
  )

  return res.json({
    proposals,
    count: Array.isArray(proposals) ? proposals.length : 0,
    limit,
    offset,
  })
}
