import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { JURISDICTION_RULES_MODULE } from "../../../../../modules/jurisdiction-rules"
import type JurisdictionRulesModuleService from "../../../../../modules/jurisdiction-rules/service"
import { resolveReviewer } from "../../reviewers"
import { ReviewBody, rejectBody, sendRuleError } from "../../schema"

/**
 * POST /admin/jurisdiction-rules/:id/review: sign off one rule version.
 *
 * Body: `{ expected_content_sha256, note? }`.
 *
 * In order:
 *
 * 1. **Who.** The reviewer is the authenticated admin user, looked up in the
 *    user module, and must be on the allowlist the operator sets in
 *    `JURISDICTION_RULE_REVIEWER_EMAILS`. Anyone else gets 403, before the
 *    body or the rule is looked at, so the answer says nothing about whether
 *    the rule exists. With the variable unset, that is everyone. Nothing in
 *    the body can name a reviewer: the schema has no such field, and unknown
 *    keys are dropped.
 * 2. **What.** `expected_content_sha256` is the hash of the text the reviewer
 *    was shown. The service marks the version reviewed in one conditional
 *    UPDATE that matches only while this version is still the pending draft
 *    and still carries that hash. Anything else is 409 `stale_review` and
 *    nothing is written.
 *
 * On success the previous reviewed version of the same rule, if any, is
 * superseded and coverage is recomputed, in the same transaction.
 *
 * The 403 and 409 here are about the admin and the rule text. Nothing on this
 * route, or reachable from it, refuses a seller or a sale.
 */
export async function POST(req: MedusaRequest<unknown>, res: MedusaResponse) {
  const id = (req.params as { id?: string })?.id
  if (!id) return res.status(400).json({ type: "invalid_request", message: "Missing id" })

  const resolution = await resolveReviewer(req)
  if (!resolution.ok) {
    return res.status(resolution.status).json({ type: resolution.type, message: resolution.message })
  }

  const parsed = ReviewBody.safeParse(req.body ?? {})
  if (!parsed.success) return rejectBody(res, parsed.error)

  const service = req.scope.resolve<JurisdictionRulesModuleService>(JURISDICTION_RULES_MODULE)
  try {
    const result = await service.markReviewed({
      rule_id: id,
      expected_content_sha256: parsed.data.expected_content_sha256,
      reviewer: { user_id: resolution.reviewer.user_id, name: resolution.reviewer.name },
      note: parsed.data.note ?? null,
    })
    return res.status(200).json(result)
  } catch (error) {
    return sendRuleError(res, error)
  }
}
