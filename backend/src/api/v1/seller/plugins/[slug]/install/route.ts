import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { SellerAuthRequest } from "../../../../../middlewares/seller-context-v1"
import { SELLER_EXTENSION_MODULE } from "../../../../../../modules/seller-extension"
import type SellerExtensionService from "../../../../../../modules/seller-extension/service"
import { PLUGIN_REGISTRY_MODULE } from "../../../../../../modules/plugin-registry"
import type PluginRegistryService from "../../../../../../modules/plugin-registry/service"

/**
 * POST /v1/seller/plugins/:slug/install
 * Install a plugin (§16) for the authenticated vendor: add it to
 * seller_metadata.enabled_extensions and bump the registry install count.
 * Idempotent — installing an already-installed plugin is a no-op success.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as SellerAuthRequest).seller_id
  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized", type: "unauthorized" })
  }
  const slug = String(req.params.slug)

  const registry = req.scope.resolve<PluginRegistryService>(
    PLUGIN_REGISTRY_MODULE
  )
  const plugin = await registry.getBySlug(slug)
  if (!plugin) {
    return res
      .status(404)
      .json({ message: `Plugin "${slug}" not found`, type: "not_found" })
  }

  const sellerExt = req.scope.resolve<SellerExtensionService>(
    SELLER_EXTENSION_MODULE
  )
  const [meta] = await sellerExt.listSellerMetadatas({ seller_id: sellerId })
  const current = Array.isArray(meta?.enabled_extensions)
    ? (meta!.enabled_extensions as string[])
    : []

  if (current.includes(slug)) {
    return res.status(200).json({ installed: current, already: true })
  }

  const next = [...current, slug]
  if (meta) {
    await (
      sellerExt as unknown as {
        updateSellerMetadatas(data: Record<string, unknown>): Promise<unknown>
      }
    ).updateSellerMetadatas({
      id: meta.id,
      enabled_extensions: next,
    })
  } else {
    await (
      sellerExt as unknown as {
        createSellerMetadatas(data: Record<string, unknown>): Promise<unknown>
      }
    ).createSellerMetadatas({
      seller_id: sellerId,
      enabled_extensions: next,
    })
  }
  await registry.incrementInstallCount(slug)

  return res.status(200).json({ installed: next, already: false })
}
