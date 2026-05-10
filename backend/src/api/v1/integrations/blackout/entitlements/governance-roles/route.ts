import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  isBlackoutIntegrationEnabled,
  verifyBlackoutToken,
} from "../../../../../../lib/blackout-oauth"

/**
 * Governance-roles endpoint per `docs/contracts/entitlements.yaml` §2.5.
 *
 * Foundation milestone: depends on the cooperative + governance modules'
 * Matrix-ACL synchronization and the MXID-keyed vendor-roles revision
 * scoped in AGGRESSIVE_OPERATIONS_GUIDE.md §2.1 and §5.1. Returns 501 with
 * `code: foundation_milestone` until those workstreams ship.
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

  return res.status(501).json({
    code: "foundation_milestone",
    message:
      "Governance roles endpoint is contractually defined but pending the cooperative/governance Matrix-ACL synchronization and vendor-roles MXID revision scoped in AGGRESSIVE_OPERATIONS_GUIDE.md §2.1 and §5.1.",
  })
}
