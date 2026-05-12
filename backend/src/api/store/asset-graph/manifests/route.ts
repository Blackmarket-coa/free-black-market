import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ASSET_GRAPH_MODULE } from "../../../../modules/asset-graph"
import type AssetGraphService from "../../../../modules/asset-graph/service"

/**
 * GET /store/asset-graph/manifests
 *
 * Public catalog read — anyone can see what verticals the substrate
 * supports. Mirrors the admin endpoint; same payload shape.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const service: any = req.scope.resolve(ASSET_GRAPH_MODULE)
  const manifests = (service as AssetGraphService).listManifests()
  return res.json({
    manifests,
    count: manifests.length,
  })
}
