import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  requireEntitlementsAuth,
  decodeMxid,
} from "../../../../../../../lib/blackout-entitlements-auth"
import { fetchEconomicStanding } from "../../../../../../../lib/blackout-economic-standing"
import { ENTITLEMENT_MODULE } from "../../../../../../../modules/entitlement"
import type EntitlementModuleService from "../../../../../../../modules/entitlement/service"

// Blackout caps the summary at 30s; advertise a TTL within that bound.
const SUMMARY_CACHE_TTL_SECONDS = 30

/**
 * §4 getSummary — GET /entitlements/summary/{mxid}
 * Combines Q2 (economic standing), Q3 (governance roles), and Q4 (coalition
 * memberships) plus `cacheTtlSeconds`.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  if (!requireEntitlementsAuth(req, res)) return

  const mxid = decodeMxid(req.params.mxid)
  const service = req.scope.resolve<EntitlementModuleService>(ENTITLEMENT_MODULE)

  const [economicStanding, governance, coalitions] = await Promise.all([
    fetchEconomicStanding(req, mxid),
    service.getGovernanceRoles(mxid),
    service.getCoalitionMemberships(mxid),
  ])

  return res.json({
    mxid,
    economicStanding,
    governanceRoles: governance.roles,
    coalitionMemberships: coalitions.memberships,
    cacheTtlSeconds: SUMMARY_CACHE_TTL_SECONDS,
  })
}
