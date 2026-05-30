import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  requireEntitlementsAuth,
  decodeMxid,
} from "../../../../../../../lib/blackout-entitlements-auth"
import { ENTITLEMENT_MODULE } from "../../../../../../../modules/entitlement"
import type EntitlementModuleService from "../../../../../../../modules/entitlement/service"

/**
 * §4 getGovernanceRoles — GET /entitlements/governance-roles/{mxid}
 * Returns `{ roles: GovernanceRole[] }`; `matrixAcls` are applied verbatim by
 * Blackout's ACL sync worker.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  if (!requireEntitlementsAuth(req, res)) return

  const mxid = decodeMxid(req.params.mxid)
  const service = req.scope.resolve<EntitlementModuleService>(ENTITLEMENT_MODULE)
  const snapshot = await service.getGovernanceRoles(mxid)
  return res.json(snapshot)
}
