import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { PLUGIN_REGISTRY_MODULE } from "../../../../../modules/plugin-registry"
import type PluginRegistryService from "../../../../../modules/plugin-registry/service"
import { ENTITLEMENT_MODULE } from "../../../../../modules/entitlement"
import type EntitlementModuleService from "../../../../../modules/entitlement/service"
import {
  buildPluginGrantInput,
  pluginFeatureKey,
} from "../../../../../modules/plugin-registry/entitlement"

/**
 * POST /store/plugins/:slug/install
 *
 * Install a plugin for the authenticated customer: grants a `plugin:<slug>`
 * entitlement and bumps the plugin's install counter. Idempotent — a customer
 * who already holds the entitlement is not re-granted and the counter is not
 * re-incremented.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const customerId = (req as any).auth_context?.actor_id as string | undefined
  if (!customerId) {
    return res.status(401).json({ message: "Authentication required" })
  }

  const slug = req.params.slug
  const registry = req.scope.resolve<PluginRegistryService>(PLUGIN_REGISTRY_MODULE)
  const entitlements = req.scope.resolve<EntitlementModuleService>(ENTITLEMENT_MODULE)

  const plugin = await registry.getBySlug(slug)
  if (!plugin) {
    return res.status(404).json({ message: `Plugin '${slug}' not found` })
  }

  const featureKey = pluginFeatureKey(slug)
  const existing = await entitlements.verify({ customer_id: customerId, feature_key: featureKey })
  if (existing.entitled) {
    return res.status(200).json({
      installed: true,
      already_installed: true,
      slug,
      feature_key: featureKey,
      entitlement_id: existing.entitlements[0]?.id ?? null,
    })
  }

  const entitlement = await entitlements.grant(
    buildPluginGrantInput({ slug, customerId })
  )
  const updated = await registry.incrementInstallCount(slug)

  return res.status(201).json({
    installed: true,
    already_installed: false,
    slug,
    feature_key: featureKey,
    entitlement_id: entitlement.id,
    install_count: updated ? Number((updated as any).install_count) : undefined,
  })
}
