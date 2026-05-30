import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  bearerToken,
  isBlackoutIntegrationEnabled,
  verifyEntitlementsServiceToken,
} from "./blackout-oauth"

/**
 * Shared gate for the §4 entitlements service routes. Enforces the
 * integration flag (503 when off) and the service-token bearer (401 when
 * missing/invalid). Returns true when the request may proceed; otherwise it
 * has already written the response and the caller should return.
 */
export function requireEntitlementsAuth(
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
  if (!token || !verifyEntitlementsServiceToken(token)) {
    res.status(401).json({ code: "unauthorized", message: "Invalid or missing service token" })
    return false
  }
  return true
}

/**
 * Decode a path-param MXID. Express usually decodes `%40`/`%3A` already, but
 * MXIDs never contain a literal `%`, so a defensive second decode is safe and
 * tolerant of double-encoded callers.
 */
export function decodeMxid(raw: unknown): string {
  const s = String(raw ?? "")
  if (!s.includes("%")) return s
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}
