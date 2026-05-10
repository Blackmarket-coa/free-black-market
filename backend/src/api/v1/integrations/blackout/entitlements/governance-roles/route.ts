import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  isBlackoutIntegrationEnabled,
  verifyBlackoutToken,
} from "../../../../../../lib/blackout-oauth"
import { ENTITLEMENT_MODULE } from "../../../../../../modules/entitlement"
import type EntitlementModuleService from "../../../../../../modules/entitlement/service"

/**
 * Governance-roles endpoint per `docs/contracts/entitlements.yaml` §2.5.
 *
 * Returns the roles, vote eligibility, Synapse power-level intent, and
 * derived FBM commerce permissions for an MXID. Coalition-side roles are
 * read off the entitlement table as `governance.role.<role>.<coalition_id>`
 * grants; the static role→permission map lives in the entitlement service.
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

  const service = req.scope.resolve<EntitlementModuleService>(ENTITLEMENT_MODULE)
  const snapshot = await service.getGovernanceRoles(mxid)
  return res.json(snapshot)
}
