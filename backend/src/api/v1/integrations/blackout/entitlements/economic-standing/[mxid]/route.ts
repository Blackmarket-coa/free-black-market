import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  requireEntitlementsAuth,
  decodeMxid,
} from "../../../../../../../lib/blackout-entitlements-auth"
import { fetchEconomicStanding } from "../../../../../../../lib/blackout-economic-standing"

/**
 * §4 getEconomicStanding — GET /entitlements/economic-standing/{mxid}
 * Returns the EconomicStanding minor-units shape. Empty totals (not 404) for an
 * MXID that has not yet transacted.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  if (!requireEntitlementsAuth(req, res)) return

  const mxid = decodeMxid(req.params.mxid)
  const standing = await fetchEconomicStanding(req, mxid)
  return res.json(standing)
}
