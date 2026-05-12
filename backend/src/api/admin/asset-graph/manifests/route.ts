import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ASSET_GRAPH_MODULE } from "../../../../modules/asset-graph"
import type AssetGraphService from "../../../../modules/asset-graph/service"

/**
 * GET /admin/asset-graph/manifests
 *
 * Returns the in-code manifest catalog. Code is the source of truth
 * (same pattern as `playbook.recipes`); this endpoint just exposes
 * what's registered. No DB read.
 */
export async function GET(_req: MedusaRequest, res: MedusaResponse) {
  const service: any = _req.scope.resolve(ASSET_GRAPH_MODULE)
  const manifests = (service as AssetGraphService).listManifests()
  return res.json({
    manifests,
    count: manifests.length,
  })
}
