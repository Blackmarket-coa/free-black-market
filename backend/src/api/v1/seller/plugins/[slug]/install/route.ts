import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { SellerAuthRequest } from "../../../../../middlewares/seller-context-v1"
import { SELLER_EXTENSION_MODULE } from "../../../../../../modules/seller-extension"
import type SellerExtensionService from "../../../../../../modules/seller-extension/service"
import { PLUGIN_REGISTRY_MODULE } from "../../../../../../modules/plugin-registry"
import type PluginRegistryService from "../../../../../../modules/plugin-registry/service"
import {
  buildPluginInstalledPayload,
  buildPluginUninstalledPayload,
  pluginHookChannelId,
} from "../../../../../../modules/plugin-registry/hooks"
import { buildSellerPluginGrantInput } from "../../../../../../modules/plugin-registry/entitlement"
import { ENTITLEMENT_MODULE } from "../../../../../../modules/entitlement"
import type EntitlementModuleService from "../../../../../../modules/entitlement/service"
import { MARKETPLACE_WEBHOOKS_MODULE } from "../../../../../../modules/marketplace-webhooks"
import type MarketplaceWebhooksService from "../../../../../../modules/marketplace-webhooks/service"
import { createLogger } from "../../../../../../shared/logger"
import { materializeExtensionsForAppend } from "../../../../../../shared/extension-keys"

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
  // A `null` column means "use my archetype defaults". Appending a slug to `[]`
  // would persist a slug-only array, which the panel resolves as "every feature
  // off" — so materialise the defaults first and append to those instead.
  const current = materializeExtensionsForAppend(meta?.enabled_extensions, meta)

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

  // W3: mirror the install as a seller-scoped `plugin:<slug>` entitlement so
  // vendor-facing surfaces can gate on verifyForSeller. STRICTLY best-effort
  // (try/catch is load-bearing): `enabled_extensions` stays the authoritative
  // record, and the route-harness specs resolve no entitlement module at all.
  try {
    const entitlements = req.scope.resolve<EntitlementModuleService>(ENTITLEMENT_MODULE)
    if (entitlements?.grant) {
      await entitlements.grant(buildSellerPluginGrantInput({ slug, sellerId }))
    }
  } catch (err) {
    log.error("[plugins/install] seller entitlement grant failed", err)
  }

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

/**
 * DELETE /v1/seller/plugins/:slug/install (W3)
 *
 * Uninstall for the seller surface: remove the slug from
 * seller_metadata.enabled_extensions. The null-column subtlety runs in
 * reverse here — removing a slug from a `null` column (archetype defaults)
 * must persist materialized-defaults-minus-slug, while removing a slug that
 * is simply absent is a 200 no-op that must NOT materialize the column.
 * Best-effort: revoke the mirrored seller entitlement, decrement the counter,
 * emit `plugin.uninstalled`.
 */
export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
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
  const current = materializeExtensionsForAppend(meta?.enabled_extensions, meta)

  if (!current.includes(slug)) {
    // Absent slug: no-op WITHOUT materializing a null column into a custom
    // selection — that would silently freeze the seller's archetype defaults.
    return res.status(200).json({ installed: current, already: true })
  }

  const next = current.filter((entry) => entry !== slug)
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
    // No metadata row but the slug was materialized from defaults — persist
    // the defaults-minus-slug selection.
    await (
      sellerExt as unknown as {
        createSellerMetadatas(data: Record<string, unknown>): Promise<unknown>
      }
    ).createSellerMetadatas({
      seller_id: sellerId,
      enabled_extensions: next,
    })
  }

  try {
    await registry.decrementInstallCount(slug)
  } catch (err) {
    log.error("[plugins/uninstall] install-count decrement failed", err)
  }

  try {
    const entitlements = req.scope.resolve<EntitlementModuleService>(ENTITLEMENT_MODULE)
    if (entitlements?.verifyForSeller) {
      const held = await entitlements.verifyForSeller({
        seller_id: sellerId,
        feature_key: `plugin:${slug}`,
      })
      for (const row of held.entitlements ?? []) {
        await entitlements.revoke(row.id, "plugin_uninstalled")
      }
    }
  } catch (err) {
    log.error("[plugins/uninstall] seller entitlement revoke failed", err)
  }

  try {
    const webhooks = req.scope.resolve<MarketplaceWebhooksService>(
      MARKETPLACE_WEBHOOKS_MODULE
    )
    await webhooks.dispatch(
      "plugin.uninstalled",
      pluginHookChannelId(slug),
      buildPluginUninstalledPayload({
        slug,
        installer_type: "seller",
        installer_seller_id: sellerId,
      })
    )
  } catch (err) {
    log.error("[plugins/uninstall] plugin.uninstalled hook dispatch failed", err)
  }

  return res.status(200).json({ installed: next, already: false })
}
