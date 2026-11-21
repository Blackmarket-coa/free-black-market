import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { JURISDICTION_RULES_MODULE } from "../../../../modules/jurisdiction-rules"
import type JurisdictionRulesModuleService from "../../../../modules/jurisdiction-rules/service"
import { getSellerId } from "../../quests/_helpers"
import { PLATES_PROGRAM, platesDisabled } from "../_shared"

/**
 * GET /vendor/plates/jurisdictions
 *
 * Every state and DC with where FBM's coverage of its home-based food rules
 * stands: `covered` (every required rule reviewed), `draft` (rules on file,
 * not all reviewed), `withdrawn`, or `not_covered`. South Carolina is the
 * first state with rules on file; every other state reads `not_covered`
 * until its own sources are archived and read.
 *
 * Behind FF_PLATES_V1 (404 when off). Information only: nothing in the
 * response is permission to sell, or a refusal.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  if (platesDisabled(res)) return

  const sellerId = await getSellerId(req)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const service = req.scope.resolve<JurisdictionRulesModuleService>(JURISDICTION_RULES_MODULE)
  const listed = await service.listCoverage(PLATES_PROGRAM)

  const jurisdictions = listed.map((entry) => ({
    code: entry.jurisdiction_code,
    name: entry.jurisdiction_name,
    coverage: entry.status,
    coverage_changed_at: entry.status_changed_at,
  }))

  res.json({ program: PLATES_PROGRAM, jurisdictions, count: jurisdictions.length })
}
