import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  requireEntitlementsAuth,
  decodeMxid,
} from "../../../../../../../lib/blackout-entitlements-auth"
import { ENTITLEMENT_MODULE } from "../../../../../../../modules/entitlement"
import type EntitlementModuleService from "../../../../../../../modules/entitlement/service"
import type { AccessAction } from "../../../../../../../modules/entitlement/service"

const ACTIONS: AccessAction[] = ["read", "write", "administer"]

/**
 * §4 checkAccess — GET /entitlements/access/{mxid}?urn=&action=
 * Returns `{ allowed, source }`.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  if (!requireEntitlementsAuth(req, res)) return

  const mxid = decodeMxid(req.params.mxid)
  const urn = String(req.query.urn || "").trim()
  const action = String(req.query.action || "").trim() as AccessAction

  if (!urn) {
    return res.status(400).json({ code: "bad_request", message: "urn is required" })
  }
  if (!ACTIONS.includes(action)) {
    return res.status(400).json({
      code: "bad_request",
      message: `action must be one of: ${ACTIONS.join(", ")}`,
    })
  }

  const service = req.scope.resolve<EntitlementModuleService>(ENTITLEMENT_MODULE)
  const result = await service.checkAccess({ mxid, urn, action })
  return res.json(result)
}
