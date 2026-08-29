import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { HAWALA_LEDGER_MODULE } from "../../../../../../modules/hawala-ledger"
import HawalaLedgerModuleService from "../../../../../../modules/hawala-ledger/service"

/**
 * GET /admin/hawala/reconciliation/runs/:id
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const hawalaService = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)
  try {
    const run = await hawalaService.retrieveReconciliationRun(req.params.id)
    res.json({ run })
  } catch {
    res.status(404).json({ error: "Run not found" })
  }
}
