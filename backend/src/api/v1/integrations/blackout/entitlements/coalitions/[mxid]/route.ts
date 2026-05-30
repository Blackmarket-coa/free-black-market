import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  requireEntitlementsAuth,
  decodeMxid,
} from "../../../../../../../lib/blackout-entitlements-auth"
import { ENTITLEMENT_MODULE } from "../../../../../../../modules/entitlement"
import type EntitlementModuleService from "../../../../../../../modules/entitlement/service"

/**
 * §4 getCoalitionMemberships — GET /entitlements/coalitions/{mxid}
 * Returns `{ memberships: CoalitionMembership[] }`. Coalition membership
 * resolution is a foundation milestone; a stable empty list is returned until
 * the cooperative module surfaces ship.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  if (!requireEntitlementsAuth(req, res)) return

  const mxid = decodeMxid(req.params.mxid)
  const service = req.scope.resolve<EntitlementModuleService>(ENTITLEMENT_MODULE)
  const result = await service.getCoalitionMemberships(mxid)
  return res.json(result)
}
