import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { PLUGIN_REGISTRY_MODULE } from "../../../../modules/plugin-registry"
import type PluginRegistryService from "../../../../modules/plugin-registry/service"

/**
 * Resolve the plugin and enforce that the caller is its author. First-party
 * plugins (`author_seller_id` null) have no seller owner and are not
 * author-manageable through these routes. Writes the 404/403 response itself
 * and returns null so callers just bail. Shared by the hooks CRUD and the
 * deprecate route (W3).
 */
export async function resolveAuthorPlugin(
  req: MedusaRequest,
  res: MedusaResponse,
  sellerId: string,
  what = "hooks"
): Promise<{ slug: string; status?: string | null } | null> {
  const slug = String(req.params.slug)
  const registry = req.scope.resolve<PluginRegistryService>(PLUGIN_REGISTRY_MODULE)
  const plugin = await registry.getBySlug(slug)
  if (!plugin) {
    res.status(404).json({ message: `Plugin "${slug}" not found`, type: "not_found" })
    return null
  }
  if (!plugin.author_seller_id || plugin.author_seller_id !== sellerId) {
    res.status(403).json({
      message: `Only the plugin's author can manage its ${what}`,
      type: "forbidden",
    })
    return null
  }
  return { slug, status: (plugin as { status?: string | null }).status }
}
