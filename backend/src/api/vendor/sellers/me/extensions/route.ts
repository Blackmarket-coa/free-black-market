import { createLogger } from "../../../../../shared/logger"
import type SellerExtensionService from "../../../../../modules/seller-extension/service"
const log = createLogger("api/vendor/sellers/me/extensions")
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { requireSellerId } from "../../../../../shared"
import { fetchSellerProfile } from "../../../../../shared/seller-profile"
import {
  createSellerMetadataRecord,
  updateSellerMetadataRecord,
} from "../../../../../modules/seller-extension/metadata-service"
import {
  buildPluginInstalledPayload,
  buildPluginUninstalledPayload,
  diffExtensions,
  pluginHookChannelId,
} from "../../../../../modules/plugin-registry/hooks"
import { MARKETPLACE_WEBHOOKS_MODULE } from "../../../../../modules/marketplace-webhooks"
import type MarketplaceWebhooksService from "../../../../../modules/marketplace-webhooks/service"
import { PLUGIN_REGISTRY_MODULE } from "../../../../../modules/plugin-registry"
import type PluginRegistryService from "../../../../../modules/plugin-registry/service"
import {
  UI_FEATURE_KEYS,
  findUnknownExtensionKeys,
} from "../../../../../shared/extension-keys"

/**
 * POST /vendor/sellers/me/extensions
 *
 * Update only the seller's enabled dashboard extensions.
 * This dedicated endpoint avoids payload-shape differences in
 * `/vendor/sellers/me` implementations across environments.
 */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const sellerId = await requireSellerId(req, res)
  if (!sellerId) return

  try {
    const body = (req.body ?? {}) as { enabled_extensions?: string[] | null }

    if (!("enabled_extensions" in body)) {
      return res.status(400).json({
        type: "invalid_data",
        message: "enabled_extensions is required",
      })
    }

    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
    const sellerExtensionModule = req.scope.resolve("sellerExtension")

    const { data: metadataRecords } = await query.graph({
      entity: "seller_metadata",
      fields: ["id", "enabled_extensions"],
      filters: { seller_id: sellerId },
    })
    const previousRaw = (
      metadataRecords?.[0] as { enabled_extensions?: unknown } | undefined
    )?.enabled_extensions
    const previousExtensions = Array.isArray(previousRaw)
      ? (previousRaw as string[])
      : []

    // Allowlist the submitted keys. This column is a set-the-whole-array write,
    // so without a check any seller can persist arbitrary strings — and once
    // plan entitlements read alongside it, an unvalidated write is how someone
    // types themselves a feature key. Permitted: the known dashboard feature
    // keys, plugin slugs the seller already has (so a deprecated plugin never
    // makes their array unsaveable), and slugs that resolve in the registry.
    const unknownKeys = await findUnknownExtensionKeys(body.enabled_extensions, {
      previouslyHeld: previousExtensions,
      resolvePluginSlug: async (slug) => {
        const registry = req.scope.resolve<PluginRegistryService>(
          PLUGIN_REGISTRY_MODULE
        )
        return Boolean(await registry.getBySlug(slug))
      },
    })

    if (unknownKeys.length) {
      return res.status(400).json({
        type: "invalid_data",
        message:
          `Unknown extension key(s): ${unknownKeys.join(", ")}. ` +
          `Expected a dashboard feature key or an installable plugin slug.`,
        unknown_keys: unknownKeys,
        allowed_feature_keys: UI_FEATURE_KEYS,
      })
    }

    if (metadataRecords && metadataRecords.length > 0) {
      const metadataId = (metadataRecords[0] as { id: string }).id
      await updateSellerMetadataRecord(sellerExtensionModule as SellerExtensionService, [
        { id: metadataId, enabled_extensions: body.enabled_extensions ?? null },
      ])
    } else {
      await createSellerMetadataRecord(sellerExtensionModule as SellerExtensionService, [
        { seller_id: sellerId, enabled_extensions: body.enabled_extensions ?? null },
      ])
    }

    // Plugin hook registry (§1.4): the set-whole-array update implies
    // installs/uninstalls — notify each affected plugin's hook endpoints.
    // Best-effort; never fails the extensions update.
    try {
      const { installed, uninstalled } = diffExtensions(
        previousExtensions,
        body.enabled_extensions ?? []
      )
      if (installed.length || uninstalled.length) {
        const webhooks = req.scope.resolve<MarketplaceWebhooksService>(
          MARKETPLACE_WEBHOOKS_MODULE
        )
        for (const slug of installed) {
          await webhooks.dispatch(
            "plugin.installed",
            pluginHookChannelId(slug),
            buildPluginInstalledPayload({
              slug,
              installer_type: "seller",
              installer_seller_id: sellerId,
            })
          )
        }
        for (const slug of uninstalled) {
          await webhooks.dispatch(
            "plugin.uninstalled",
            pluginHookChannelId(slug),
            buildPluginUninstalledPayload({ slug, installer_seller_id: sellerId })
          )
        }
      }
    } catch (hookErr) {
      log.error("[extensions] plugin hook dispatch failed", hookErr)
    }

    const seller = await fetchSellerProfile({
      req,
      sellerId,
      requestedFields: req.query.fields,
    })

    return res.json({ seller })
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error"
    log.error("[POST /vendor/sellers/me/extensions] Error:", errorMessage)
    return res.status(500).json({
      type: "server_error",
      message: "Failed to update seller extensions",
    })
  }
}
