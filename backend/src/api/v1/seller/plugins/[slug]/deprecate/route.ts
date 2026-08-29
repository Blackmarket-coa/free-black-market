import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import type { SellerAuthRequest } from "../../../../../middlewares/seller-context-v1"
import { PLUGIN_REGISTRY_MODULE } from "../../../../../../modules/plugin-registry"
import type PluginRegistryService from "../../../../../../modules/plugin-registry/service"
import { PluginStatus } from "../../../../../../modules/plugin-registry/models/plugin-listing"
import {
  buildPluginDeprecatedPayload,
  pluginHookChannelId,
} from "../../../../../../modules/plugin-registry/hooks"
import { MARKETPLACE_WEBHOOKS_MODULE } from "../../../../../../modules/marketplace-webhooks"
import type MarketplaceWebhooksService from "../../../../../../modules/marketplace-webhooks/service"
import { resolveAuthorPlugin } from "../../author-guard"
import { createLogger } from "../../../../../../shared/logger"

const log = createLogger("api/v1/seller/plugins/deprecate")

const BodySchema = z.object({
  reason: z.string().max(500).nullish(),
})

/**
 * POST /v1/seller/plugins/:slug/deprecate (W3)
 *
 * Author-only deprecation: sets the catalog row DEPRECATED (the install gate
 * already blocks deprecated plugins) and emits `plugin.deprecated` — the
 * first real emitter of the third contract event. Idempotent. There is no
 * un-deprecate API; publishing a new version through the seller publish
 * bridge revives the listing (docs/contracts/extension-manifest.md).
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as SellerAuthRequest).seller_id
  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized", type: "unauthorized" })
  }

  const plugin = await resolveAuthorPlugin(req, res, sellerId, "lifecycle")
  if (!plugin) return

  const parsed = BodySchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    return res.status(400).json({
      message: "Invalid deprecate payload",
      type: "invalid_request",
      errors: parsed.error.flatten(),
    })
  }

  if (plugin.status === PluginStatus.DEPRECATED) {
    return res.status(200).json({ slug: plugin.slug, status: plugin.status, already: true })
  }

  const registry = req.scope.resolve<PluginRegistryService>(PLUGIN_REGISTRY_MODULE)
  const row = await registry.getBySlug(plugin.slug)
  await registry.updatePluginListings({
    id: row!.id,
    status: PluginStatus.DEPRECATED,
  })

  // Best-effort — a hook hiccup never fails the deprecation.
  try {
    const webhooks = req.scope.resolve<MarketplaceWebhooksService>(
      MARKETPLACE_WEBHOOKS_MODULE
    )
    await webhooks.dispatch(
      "plugin.deprecated",
      pluginHookChannelId(plugin.slug),
      buildPluginDeprecatedPayload({ slug: plugin.slug, reason: parsed.data.reason })
    )
  } catch (err) {
    log.error("[plugins/deprecate] plugin.deprecated hook dispatch failed", err)
  }

  return res.status(200).json({
    slug: plugin.slug,
    status: PluginStatus.DEPRECATED,
    already: false,
  })
}
