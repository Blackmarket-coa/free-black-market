import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { HAWALA_LEDGER_MODULE } from "../../../../../../modules/hawala-ledger"
import HawalaLedgerModuleService from "../../../../../../modules/hawala-ledger/service"

/**
 * GET /admin/hawala/entries/:id/lineage
 * The entry's family: its correlation group when it has one, its order
 * lineage when it only carries an order, otherwise its immediate
 * parent/children by parent_entry_id.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const hawalaService = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)
  try {
    const lineage = await hawalaService.getEntryLineage(req.params.id)
    res.json(lineage)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to compute lineage"
    const status = message.toLowerCase().includes("not found") ? 404 : 500
    res.status(status).json({ error: message })
  }
}
