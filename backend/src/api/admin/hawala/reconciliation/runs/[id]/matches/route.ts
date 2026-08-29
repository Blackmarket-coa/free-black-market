import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { HAWALA_LEDGER_MODULE } from "../../../../../../../modules/hawala-ledger"
import HawalaLedgerModuleService from "../../../../../../../modules/hawala-ledger/service"

/**
 * GET /admin/hawala/reconciliation/runs/:id/matches
 * What actually matched, with rule attribution and the audited cents
 * delta. (The Blnk reference exposed only the two counters; being able
 * to see the matches is the point.)
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const hawalaService = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)
  const { limit = "50", offset = "0" } = req.query
  const take = Math.min(Math.max(parseInt(limit as string) || 50, 1), 200)
  const skip = Math.max(parseInt(offset as string) || 0, 0)

  const matches = await hawalaService.listReconciliationMatches(
    { run_id: req.params.id },
    { take, skip }
  )
  res.json({ matches, count: matches.length, limit: take, offset: skip })
}
