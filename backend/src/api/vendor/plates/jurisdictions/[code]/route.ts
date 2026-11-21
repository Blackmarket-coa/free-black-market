import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  JURISDICTION_RULES_MODULE,
  normalizeUsJurisdiction,
  usJurisdictionName,
} from "../../../../../modules/jurisdiction-rules"
import type JurisdictionRulesModuleService from "../../../../../modules/jurisdiction-rules/service"
import { getSellerId } from "../../../quests/_helpers"
import { PLATES_PROGRAM, coverageForSeller, platesDisabled, ruleForSeller } from "../../_shared"

/**
 * GET /vendor/plates/jurisdictions/:code
 *
 * The home-based food rules FBM has on file for one state, as a seller is
 * shown them. `:code` is the ISO 3166-2 code (`US-SC`); the postal code and
 * the state's name are read too.
 *
 * Each rule carries the wording FBM shows, the source's own words beside it,
 * and for every citation the source document with its document id and printed
 * date. A date or id the document does not print reads "not stated", and so
 * does a rule's effective date when the source gives none. Each rule says
 * whether it is reviewed, by whom and when; a rule that has not been reviewed
 * is included and marked `is_draft: true`.
 *
 * A state with nothing on file answers 200 with `coverage.status:
 * "not_covered"` and no rules: "we have not read this state's rules" is an
 * answer, not an error. A code that is not a US state or DC is 404.
 *
 * Behind FF_PLATES_V1 (404 when off). Information only: the response
 * describes documents. It does not say whether this seller may sell anything,
 * and nothing reads it to stop a sale.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  if (platesDisabled(res)) return

  const sellerId = await getSellerId(req)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const code = normalizeUsJurisdiction((req.params as { code?: string })?.code)
  if (!code) {
    return res.status(404).json({
      type: "not_found",
      message: "That is not a US state or DC code this reads. Use the ISO code, such as US-SC.",
    })
  }

  const service = req.scope.resolve<JurisdictionRulesModuleService>(JURISDICTION_RULES_MODULE)
  const view = await service.getRuleView(code, PLATES_PROGRAM, { includeDrafts: true })

  res.json({
    jurisdiction: { code, name: usJurisdictionName(code) },
    program: PLATES_PROGRAM,
    coverage: coverageForSeller(view),
    rules: view.rules.map(ruleForSeller),
    count: view.rules.length,
  })
}
