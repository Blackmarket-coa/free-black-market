import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ASSET_GRAPH_MODULE } from "../../../../modules/asset-graph"
import type AssetGraphService from "../../../../modules/asset-graph/service"

/**
 * GET /admin/asset-graph/proposals
 *
 * Query params:
 *   manifest_slug   filter to one manifest's proposals
 *   member_id       filter to one candidate operator
 *   state           pending | accepted | declined | expired
 *   limit / offset  pagination
 *
 * Returns the persisted MatchProposal rows. Run a match
 * (`POST /admin/asset-graph/manifests/:slug/match` with
 * `persist: true`) to populate.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const service: any = req.scope.resolve(ASSET_GRAPH_MODULE)

  const filters: Record<string, unknown> = {}
  if (req.query.manifest_slug) filters.manifest_slug = req.query.manifest_slug
  if (req.query.member_id) filters.member_id = req.query.member_id
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
