import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { JURISDICTION_RULES_MODULE } from "../../../../../modules/jurisdiction-rules"
import type JurisdictionRulesModuleService from "../../../../../modules/jurisdiction-rules/service"
import { adminUserIdOf } from "../../reviewers"
import { WithdrawBody, rejectBody, sendRuleError } from "../../schema"

/**
 * POST /admin/jurisdiction-rules/:id/withdraw: withdraw a rule version that
 * is in force (a pending draft, or the reviewed version).
 *
 * Body: `{ reason }`. The row stays, marked with who withdrew it, when and
 * why; who is the authenticated admin user, never a field of the body.
 * Withdrawing the reviewed version leaves its rule with no reviewed text, so
 * coverage is recomputed in the same transaction and stops reading `covered`.
 *
 * Any admin user may withdraw; the reviewer allowlist is not consulted. The
 * two directions are not symmetric. Signing off makes FBM say more, so it is
 * restricted to the people named for it. Withdrawing makes FBM say less, and
 * the admin who notices a wrong rule should be able to take it down without
 * waiting for a reviewer; putting text back needs a reviewer again. An API
 * key cannot withdraw: there would be no user to record.
 */
export async function POST(req: MedusaRequest<unknown>, res: MedusaResponse) {
  const id = (req.params as { id?: string })?.id
  if (!id) return res.status(400).json({ type: "invalid_request", message: "Missing id" })

  const userId = adminUserIdOf(req)
  if (!userId) {
    return res.status(403).json({
      type: "forbidden",
      message: "A rule is withdrawn from an admin user's own login. An API key cannot withdraw.",
    })
  }

  const parsed = WithdrawBody.safeParse(req.body ?? {})
  if (!parsed.success) return rejectBody(res, parsed.error)

  const service = req.scope.resolve<JurisdictionRulesModuleService>(JURISDICTION_RULES_MODULE)
  try {
    const result = await service.withdrawRule({
      rule_id: id,
      withdrawn_by_user_id: userId,
      reason: parsed.data.reason,
    })
    return res.status(200).json(result)
  } catch (error) {
    return sendRuleError(res, error)
  }
}
