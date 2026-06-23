import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { SellerAuthRequest } from "../../../../middlewares/seller-context-v1"
import { SELLER_EXTENSION_MODULE } from "../../../../../modules/seller-extension"
import type SellerExtensionService from "../../../../../modules/seller-extension/service"
import { PLUGIN_REGISTRY_MODULE } from "../../../../../modules/plugin-registry"
import type PluginRegistryService from "../../../../../modules/plugin-registry/service"

/**
 * GET /v1/seller/plugins/installed
 * The authenticated vendor's installed plugin slugs (§16) plus the available
 * catalog, so the vendor Plugins page needs only seller auth.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as SellerAuthRequest).seller_id
  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized", type: "unauthorized" })
  }

  const sellerExt = req.scope.resolve<SellerExtensionService>(
    SELLER_EXTENSION_MODULE
  )
  const [meta] = await sellerExt.listSellerMetadatas({ seller_id: sellerId })
  const installed = Array.isArray(meta?.enabled_extensions)
    ? (meta!.enabled_extensions as string[])
    : []

  const registry = req.scope.resolve<PluginRegistryService>(
    PLUGIN_REGISTRY_MODULE
  )
  const available = await registry.listPublished({ limit: 200 })

  return res.status(200).json({
    installed,
    available: available.map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      description: p.description,
      install_count: p.install_count,
    })),
  })
}
