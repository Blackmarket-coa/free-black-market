import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ASSET_GRAPH_MODULE } from "../../../../modules/asset-graph"
import type AssetGraphService from "../../../../modules/asset-graph/service"

/**
 * GET /admin/asset-graph/asset-kinds
 *
 * Returns the in-code asset-kind taxonomy. The `attribute_schema`
 * field is a zod schema object — not portable JSON — so the response
 * elides it and substitutes a marker. The DB row carries the same
 * marker (see seed-asset-graph). Callers needing the schema reach
 * through the module's exported `getAssetKind` directly.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const service = req.scope.resolve<AssetGraphService>(ASSET_GRAPH_MODULE)
  const catalog = service.listAssetKindCatalog()

  // Elide the zod schema from the wire payload. Same pattern the
  // seeder uses for the DB column.
  const wireCatalog = catalog.map((k) => ({
    slug: k.slug,
    category: k.category,
    parent_slug: k.parent_slug,
    display_name: k.display_name,
    default_sensitivity_tier: k.default_sensitivity_tier,
    default_lifecycle: k.default_lifecycle,
    _attribute_schema_in_code: true,
  }))

  return res.json({
    asset_kinds: wireCatalog,
    count: wireCatalog.length,
  })
}
