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
    const previousExtensions = Array.isArray(
      (metadataRecords?.[0] as { enabled_extensions?: unknown })?.enabled_extensions
    )
      ? ((metadataRecords![0] as { enabled_extensions: string[] }).enabled_extensions)
      : []

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
