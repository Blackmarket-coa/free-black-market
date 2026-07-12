import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ENTITLEMENT_MODULE } from "../../../../../modules/entitlement"
import type EntitlementModuleService from "../../../../../modules/entitlement/service"
import { pluginFeatureKey } from "../../../../../modules/plugin-registry/entitlement"

/**
 * GET /store/plugins/:slug/entitlement
 *
 * Verify whether the authenticated customer currently holds an active
 * `plugin:<slug>` entitlement (i.e. has the plugin installed / access is live).
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const customerId = (req as any).auth_context?.actor_id as string | undefined
  if (!customerId) {
    return res.status(401).json({ message: "Authentication required" })
  }

  const slug = req.params.slug
  const featureKey = pluginFeatureKey(slug)
  const entitlements = req.scope.resolve<EntitlementModuleService>(ENTITLEMENT_MODULE)

  const result = await entitlements.verify({ customer_id: customerId, feature_key: featureKey })

  return res.status(200).json({
    slug,
    feature_key: featureKey,
    entitled: result.entitled,
    entitlement_id: result.entitlements[0]?.id ?? null,
    expires_at: result.entitlements[0]?.expires_at ?? null,
  })
}
