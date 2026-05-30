import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  bearerToken,
  isBlackoutIntegrationEnabled,
  verifyCommerceApiKey,
} from "./blackout-oauth"

/**
 * Shared gate for the §5 Blackout commerce API. Enforces the integration flag
 * (503 when off) and the `FREEBLACKMARKET_API_KEY` bearer (401 when
 * missing/invalid). Returns true when the request may proceed; otherwise it has
 * already written the response.
 */
export function requireCommerceApiKey(
  req: MedusaRequest,
  res: MedusaResponse
): boolean {
  if (!isBlackoutIntegrationEnabled()) {
    res
      .status(503)
      .json({ code: "service_disabled", message: "Blackout integration is disabled (FBM_BLACKOUT_INTEGRATION!=1)" })
    return false
  }
  const token = bearerToken(req)
  if (!token || !verifyCommerceApiKey(token)) {
    res.status(401).json({ code: "unauthorized", message: "Invalid or missing API key" })
    return false
  }
  return true
}
