import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ASSET_GRAPH_MODULE } from "../../../../../modules/asset-graph"
import type AssetGraphService from "../../../../../modules/asset-graph/service"
import type { ManifestSlug } from "../../../../../modules/asset-graph/manifests"

/**
 * GET /admin/asset-graph/manifests/:slug
 *
 * Returns one manifest by slug. 404 if the slug isn't registered.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const slug = req.params.slug
  if (!slug) return res.status(400).json({ message: "slug is required" })

  const service: any = req.scope.resolve(ASSET_GRAPH_MODULE)
  try {
    const manifest = (service as AssetGraphService).getManifestRecipe(
      slug as ManifestSlug
    )
    return res.json({ manifest })
  } catch (err) {
    return res.status(404).json({
      message: err instanceof Error ? err.message : "Unknown manifest slug",
    })
  }
}
