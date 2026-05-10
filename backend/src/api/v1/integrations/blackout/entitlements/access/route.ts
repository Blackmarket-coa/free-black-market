import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  isBlackoutIntegrationEnabled,
  verifyBlackoutToken,
} from "../../../../../../lib/blackout-oauth"
import { ENTITLEMENT_MODULE } from "../../../../../../modules/entitlement"
import type EntitlementModuleService from "../../../../../../modules/entitlement/service"

const RESOURCE_KINDS = [
  "matrix-room",
  "fbm-listing",
  "governance-proposal",
  "fulfillment-node",
  "ledger-tx",
  "platform-admin",
] as const

const ACTIONS = ["read", "write", "admin"] as const

type ResourceKind = (typeof RESOURCE_KINDS)[number]
type Action = (typeof ACTIONS)[number]

/**
 * Access decision endpoint per `docs/contracts/entitlements.yaml` §2.5.
 *
 * Query params: mxid, resource (encoded as `<kind>:<id>`), action.
 * Returns: { allowed, reasons[], evaluated_at }.
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
  const resourceParam = String(req.query.resource || "").trim()
  const action = String(req.query.action || "").trim() as Action

  if (!mxid) {
    return res.status(400).json({ code: "bad_request", message: "mxid is required" })
  }
  if (!resourceParam || !resourceParam.includes(":")) {
    return res.status(400).json({
      code: "bad_request",
      message: "resource is required in `<kind>:<id>` form",
    })
  }
  const sep = resourceParam.indexOf(":")
  const resourceKind = resourceParam.slice(0, sep) as ResourceKind
  const resourceId = resourceParam.slice(sep + 1)

  if (!RESOURCE_KINDS.includes(resourceKind)) {
    return res.status(400).json({
      code: "bad_request",
      message: `resource kind must be one of: ${RESOURCE_KINDS.join(", ")}`,
    })
  }
  if (!ACTIONS.includes(action)) {
    return res.status(400).json({
      code: "bad_request",
      message: `action must be one of: ${ACTIONS.join(", ")}`,
    })
  }

  const service = req.scope.resolve<EntitlementModuleService>(ENTITLEMENT_MODULE)
  const decision = await service.evaluateAccess({
    mxid,
    resourceKind,
    resourceId,
    action,
  })
  return res.json(decision)
}
