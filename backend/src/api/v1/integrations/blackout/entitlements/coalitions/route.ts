import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  isBlackoutIntegrationEnabled,
  verifyBlackoutToken,
} from "../../../../../../lib/blackout-oauth"

/**
 * Coalition-memberships endpoint per `docs/contracts/entitlements.yaml` §2.5.
 *
 * Foundation milestone: depends on the cooperative module's coalition
 * membership surfaces scoped in AGGRESSIVE_OPERATIONS_GUIDE.md §5.1.
 * Returns 501 with `code: foundation_milestone` until that workstream ships.
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
      "Coalition memberships endpoint is contractually defined but pending the cooperative module surfaces scoped in AGGRESSIVE_OPERATIONS_GUIDE.md §5.1.",
  })
}
