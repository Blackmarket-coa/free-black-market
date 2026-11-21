import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { JURISDICTION_RULES_MODULE } from "../../../modules/jurisdiction-rules"
import type JurisdictionRulesModuleService from "../../../modules/jurisdiction-rules/service"
import type { JurisdictionSourceRecord } from "../../../modules/jurisdiction-rules/service"
import { rejectBody } from "../jurisdiction-rules/schema"

const ListSourcesQuery = z.object({
  jurisdiction_code: z.string().trim().min(1).max(10).optional(),
})

/**
 * GET /admin/jurisdiction-sources: the archived documents rules can cite,
 * with each one's document id, printed date, SHA-256 and repository path.
 * Filter with `jurisdiction_code`.
 *
 * Read-only by design. A source is a file archived under `docs/sources/` and
 * its hash, recorded by a seed; there is no route that adds or edits one, so
 * a citation always leads to bytes that went through a pull request.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const parsed = ListSourcesQuery.safeParse(req.query ?? {})
  if (!parsed.success) return rejectBody(res, parsed.error)

  const service = req.scope.resolve<JurisdictionRulesModuleService>(JURISDICTION_RULES_MODULE)
  const sources = (await service.listJurisdictionSources(
    parsed.data.jurisdiction_code ? { jurisdiction_code: parsed.data.jurisdiction_code } : {},
    { order: { jurisdiction_code: "ASC", created_at: "ASC" } }
  )) as unknown as JurisdictionSourceRecord[]
  return res.status(200).json({ sources, count: sources.length })
}
