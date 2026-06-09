import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { PLUGIN_REGISTRY_MODULE } from "../../../modules/plugin-registry"
import type PluginRegistryService from "../../../modules/plugin-registry/service"

/**
 * GET /store/plugins
 * Browse the Black Market plugin ecosystem (§16): marketplace extensions,
 * analytics, and automation tools. Filter by ?category=.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const registry = req.scope.resolve<PluginRegistryService>(
    PLUGIN_REGISTRY_MODULE
  )
  const { category, limit = "100" } = req.query as Record<string, string>

  const plugins = await registry.listPublished({
    category,
    limit: Math.min(parseInt(limit, 10) || 100, 200),
  })

  return res.status(200).json({
    count: plugins.length,
    plugins: (plugins as any[]).map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      description: p.description,
      version: p.version,
      install_count: p.install_count,
    })),
  })
}
