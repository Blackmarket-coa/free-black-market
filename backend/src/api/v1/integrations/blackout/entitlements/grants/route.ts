import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  isBlackoutIntegrationEnabled,
  verifyBlackoutToken,
} from "../../../../../../lib/blackout-oauth"
import { ENTITLEMENT_MODULE } from "../../../../../../modules/entitlement"
import type EntitlementModuleService from "../../../../../../modules/entitlement/service"
import { EntitlementStatus } from "../../../../../../modules/entitlement/models"

/**
 * List grants for a Matrix MXID per `docs/contracts/entitlements.yaml` §2.5.
 *
 * Query params: mxid (required), status (optional), feature_key (optional).
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  if (!isBlackoutIntegrationEnabled()) {
    return res
      .status(503)
      .json({ code: "service_disabled", message: "Blackout integration is disabled (FBM_BLACKOUT_INTEGRATION!=1)" })
  }

  const header = req.headers.authorization
  const token = typeof header === "string" && header.startsWith("Bearer ")
    ? header.slice("Bearer ".length).trim()
    : null
  if (!token || !verifyBlackoutToken(token)) {
    return res.status(401).json({ code: "unauthorized", message: "Invalid or missing Bearer token" })
  }

  const mxid = String(req.query.mxid || "").trim()
  if (!mxid) {
    return res.status(400).json({ code: "bad_request", message: "mxid is required" })
  }

  const statusRaw = req.query.status ? String(req.query.status) : undefined
  if (statusRaw && !Object.values(EntitlementStatus).includes(statusRaw as EntitlementStatus)) {
    return res.status(400).json({
      code: "bad_request",
      message: `status must be one of: ${Object.values(EntitlementStatus).join(", ")}`,
    })
  }
  const featureKey = req.query.feature_key ? String(req.query.feature_key) : undefined

  const service = req.scope.resolve<EntitlementModuleService>(ENTITLEMENT_MODULE)
  const grants = await service.listGrantsByMxid(mxid, {
    status: statusRaw as EntitlementStatus | undefined,
    featureKey,
  })
  return res.json({ grants })
}
