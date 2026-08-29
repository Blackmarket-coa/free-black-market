import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { HAWALA_LEDGER_MODULE } from "../../../../../../../modules/hawala-ledger"
import HawalaLedgerModuleService from "../../../../../../../modules/hawala-ledger/service"

/**
 * GET /admin/hawala/reconciliation/runs/:id/unmatched
 * External records from the run's upload batch that no rule matched —
 * the operator's worklist (a missing ledger entry, a bad reference, or
 * an external movement the platform never recorded).
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const hawalaService = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)
  const { limit = "50", offset = "0" } = req.query
  const take = Math.min(Math.max(parseInt(limit as string) || 50, 1), 200)
  const skip = Math.max(parseInt(offset as string) || 0, 0)

  let run
  try {
    run = await hawalaService.retrieveReconciliationRun(req.params.id)
  } catch {
    return res.status(404).json({ error: "Run not found" })
  }

  const records = await hawalaService.listExternalRecords(
    { upload_id: (run as { upload_id: string }).upload_id, status: "UNMATCHED" },
    { take, skip }
  )
  res.json({ records, count: records.length, limit: take, offset: skip })
}
