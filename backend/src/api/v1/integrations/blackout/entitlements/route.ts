import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  isBlackoutIntegrationEnabled,
  verifyBlackoutToken,
} from "../../../../../lib/blackout-oauth"
import { ENTITLEMENT_MODULE } from "../../../../../modules/entitlement"
import type EntitlementModuleService from "../../../../../modules/entitlement/service"

/**
 * Blackout-side entitlement verification endpoint.
 *
 * Auth: Bearer token issued by `/v1/integrations/blackout/oauth/token`
 * via OAuth client_credentials. The token must have iss=fbm, aud=blackout.
 *
 * Query: customer_external_id (or customer_id) + feature_key
 *
 * Returns: { entitled: boolean, entitlements: Entitlement[] }
 *
 * Behavior when FBM_BLACKOUT_INTEGRATION!=1: 503.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  if (!isBlackoutIntegrationEnabled()) {
    return res
      .status(503)
      .json({ message: "Blackout integration is disabled (FBM_BLACKOUT_INTEGRATION!=1)" })
  }

  // Bearer auth — required when integration enabled.
  const header = req.headers.authorization
  const token = typeof header === "string" && header.startsWith("Bearer ")
    ? header.slice("Bearer ".length).trim()
    : null
  if (!token || !verifyBlackoutToken(token)) {
    return res.status(401).json({ message: "Invalid or missing Bearer token" })
  }

  const featureKey = String(req.query.feature_key || "")
  const customerId = req.query.customer_id ? String(req.query.customer_id) : undefined
  const customerExternalId = req.query.customer_external_id
    ? String(req.query.customer_external_id)
    : undefined

  if (!featureKey) {
    return res.status(400).json({ message: "feature_key is required" })
  }
  if (!customerId && !customerExternalId) {
    return res.status(400).json({
      message: "customer_id or customer_external_id is required",
    })
  }

  const service = req.scope.resolve<EntitlementModuleService>(ENTITLEMENT_MODULE)
  const result = await service.verify({
    customer_id: customerId,
    customer_external_id: customerExternalId,
    feature_key: featureKey,
  })
  return res.json(result)
}
