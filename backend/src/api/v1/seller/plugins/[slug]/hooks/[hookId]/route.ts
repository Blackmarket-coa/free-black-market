import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { SellerAuthRequest } from "../../../../../../middlewares/seller-context-v1"
import { PLUGIN_REGISTRY_MODULE } from "../../../../../../../modules/plugin-registry"
import type PluginRegistryService from "../../../../../../../modules/plugin-registry/service"
import { pluginHookChannelId } from "../../../../../../../modules/plugin-registry/hooks"
import { MARKETPLACE_WEBHOOKS_MODULE } from "../../../../../../../modules/marketplace-webhooks"
import type MarketplaceWebhooksService from "../../../../../../../modules/marketplace-webhooks/service"

/**
 * DELETE /v1/seller/plugins/:slug/hooks/:hookId
 * Remove one of the plugin's hook endpoints (author-only).
 */
export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as SellerAuthRequest).seller_id
  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized", type: "unauthorized" })
  }

  const slug = String(req.params.slug)
  const registry = req.scope.resolve<PluginRegistryService>(PLUGIN_REGISTRY_MODULE)
  const plugin = await registry.getBySlug(slug)
  if (!plugin) {
    return res
      .status(404)
      .json({ message: `Plugin "${slug}" not found`, type: "not_found" })
  }
  if (!plugin.author_seller_id || plugin.author_seller_id !== sellerId) {
    return res.status(403).json({
      message: "Only the plugin's author can manage its hooks",
      type: "forbidden",
    })
  }

  const webhooks = req.scope.resolve<MarketplaceWebhooksService>(
    MARKETPLACE_WEBHOOKS_MODULE
  )
  const [hook] = await webhooks.listWebhookSubscriptions({
    id: req.params.hookId,
    seller_id: pluginHookChannelId(slug),
  })
  if (!hook) {
    return res.status(404).json({ message: "Hook not found", type: "not_found" })
  }

  await webhooks.deleteWebhookSubscriptions(hook.id)
  return res.json({ id: hook.id, deleted: true })
}
