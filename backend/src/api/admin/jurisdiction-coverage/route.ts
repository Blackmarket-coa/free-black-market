import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { JURISDICTION_PROGRAMS, JURISDICTION_RULES_MODULE } from "../../../modules/jurisdiction-rules"
import type JurisdictionRulesModuleService from "../../../modules/jurisdiction-rules/service"
import { rejectBody } from "../jurisdiction-rules/schema"

const CoverageQuery = z.object({
  program: z.enum(JURISDICTION_PROGRAMS).optional(),
})

/**
 * GET /admin/jurisdiction-coverage: every state and DC, with where its
 * coverage stands for a program (`home_based_food` unless `program` says
 * otherwise). For a jurisdiction that has been opened, also the rule keys
 * coverage requires and the ones still without a reviewed version in force.
 *
 * Read-only by design. `covered` is computed from the rules, never set, and
 * the required keys are set by the seed that opens a jurisdiction; there is no
 * route that changes either, so what "covered" takes cannot be loosened here.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const parsed = CoverageQuery.safeParse(req.query ?? {})
  if (!parsed.success) return rejectBody(res, parsed.error)
  const program = parsed.data.program ?? "home_based_food"

  const service = req.scope.resolve<JurisdictionRulesModuleService>(JURISDICTION_RULES_MODULE)
  // Computed from the rule versions on file, not read from a stored status.
  const jurisdictions = await service.listCoverage(program)

  return res.status(200).json({ program, jurisdictions, count: jurisdictions.length })
}
