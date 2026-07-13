import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { SellerAuthRequest } from "../../../../../middlewares/seller-context-v1"
import { SELLER_EXTENSION_MODULE } from "../../../../../../modules/seller-extension"
import type SellerExtensionService from "../../../../../../modules/seller-extension/service"
import { PLUGIN_REGISTRY_MODULE } from "../../../../../../modules/plugin-registry"
import type PluginRegistryService from "../../../../../../modules/plugin-registry/service"
import {
  buildPluginInstalledPayload,
  pluginHookChannelId,
} from "../../../../../../modules/plugin-registry/hooks"
import { MARKETPLACE_WEBHOOKS_MODULE } from "../../../../../../modules/marketplace-webhooks"
import type MarketplaceWebhooksService from "../../../../../../modules/marketplace-webhooks/service"
import { createLogger } from "../../../../../../shared/logger"

const log = createLogger("api/v1/seller/plugins/install")

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
  const updated = await registry.incrementInstallCount(slug)

  // Plugin hook registry (§1.4): notify the plugin's registered hook
  // endpoints. Best-effort — a hook hiccup never fails the install.
  try {
    const webhooks = req.scope.resolve<MarketplaceWebhooksService>(
      MARKETPLACE_WEBHOOKS_MODULE
    )
    await webhooks.dispatch(
      "plugin.installed",
      pluginHookChannelId(slug),
      buildPluginInstalledPayload({
        slug,
        installer_type: "seller",
        installer_seller_id: sellerId,
        install_count: updated ? Number(updated.install_count) : null,
      })
    )
  } catch (err) {
    log.error("[plugins/install] plugin.installed hook dispatch failed", err)
  }

  return res.status(200).json({ installed: next, already: false })
}
