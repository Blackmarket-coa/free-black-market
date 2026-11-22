import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { JURISDICTION_RULES_MODULE } from "../../../modules/jurisdiction-rules"
import type JurisdictionRulesModuleService from "../../../modules/jurisdiction-rules/service"
import { adminUserIdOf } from "./reviewers"
import { CreateDraftBody, ListRulesQuery, rejectBody, sendRuleError } from "./schema"

/**
 * GET  /admin/jurisdiction-rules: every rule version on file, history
 *      included, each with where it stands (`pending_draft`,
 *      `reviewed_in_force`, `superseded`, `withdrawn`). Filter with
 *      `jurisdiction_code`, `program`, `rule_key`.
 * POST /admin/jurisdiction-rules: propose a new version of a rule, as a
 *      draft. The first version of a key is version 1; a later one is the
 *      next number and supersedes a pending draft. A reviewed version stays in
 *      force until the new draft is itself reviewed.
 *
 * Admin-only, and not behind FF_PLATES_V1: sign-off has to happen before the
 * flag is turned on for sellers. Any admin user may propose a draft, from
 * their own login: the version records them as `proposed_by_user_id`, and an
 * API key is refused (403), since there would be no user to record. A draft
 * is shown to sellers as a draft. Only a reviewer can turn one into reviewed
 * text (`[id]/review/route.ts`).
 *
 * The body cannot carry a version number, a hash or a review field (the
 * schema is strict). A draft with no citation is refused with 400.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const parsed = ListRulesQuery.safeParse(req.query ?? {})
  if (!parsed.success) return rejectBody(res, parsed.error)

  const service = req.scope.resolve<JurisdictionRulesModuleService>(JURISDICTION_RULES_MODULE)
  const rules = await service.listRuleVersions(parsed.data)
  return res.status(200).json({ rules, count: rules.length })
}

export async function POST(req: MedusaRequest<unknown>, res: MedusaResponse) {
  const userId = adminUserIdOf(req)
  if (!userId) {
    return res.status(403).json({
      type: "forbidden",
      message: "A rule version is proposed from an admin user's own login. An API key cannot propose one.",
    })
  }

  const parsed = CreateDraftBody.safeParse(req.body ?? {})
  if (!parsed.success) return rejectBody(res, parsed.error)

  const service = req.scope.resolve<JurisdictionRulesModuleService>(JURISDICTION_RULES_MODULE)
  try {
    const result = await service.createDraftVersion(
      { ...parsed.data, program: parsed.data.program ?? "home_based_food" },
      { proposedByUserId: userId }
    )
    if (!result.created) {
      // Unreachable from here: only the seed asks for "only if the key is new".
      return res.status(409).json({ type: "conflict", message: "This rule already has a version." })
    }
    return res.status(201).json({
      rule: result.rule,
      superseded_draft_id: result.superseded_draft_id,
      coverage: result.coverage,
    })
  } catch (error) {
    return sendRuleError(res, error)
  }
}
