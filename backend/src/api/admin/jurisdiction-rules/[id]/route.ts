import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { JURISDICTION_RULES_MODULE } from "../../../../modules/jurisdiction-rules"
import type JurisdictionRulesModuleService from "../../../../modules/jurisdiction-rules/service"
import type { JurisdictionSourceRecord } from "../../../../modules/jurisdiction-rules/service"

/**
 * GET /admin/jurisdiction-rules/:id: one rule version, the other versions of
 * the same rule (newest first), and the source documents this version cites.
 *
 * `rule.content_sha256` is what a reviewer sends back to
 * `POST /admin/jurisdiction-rules/:id/review` as `expected_content_sha256`:
 * the hash of exactly the text this response shows.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const id = (req.params as { id?: string })?.id
  if (!id) return res.status(400).json({ type: "invalid_request", message: "Missing id" })

  const service = req.scope.resolve<JurisdictionRulesModuleService>(JURISDICTION_RULES_MODULE)
  const [rule] = await service.listRuleVersions({ id })
  if (!rule) return res.status(404).json({ type: "not_found", message: "No such rule version." })

  const history = await service.listRuleVersions({
    jurisdiction_code: rule.jurisdiction_code,
    program: rule.program,
    rule_key: rule.rule_key,
  })
  const sourceIds = [...new Set(rule.citations.map((citation) => citation.source_id))]
  const sources = sourceIds.length
    ? ((await service.listJurisdictionSources({ id: sourceIds })) as unknown as JurisdictionSourceRecord[])
    : []

  return res.status(200).json({ rule, history, sources })
}
