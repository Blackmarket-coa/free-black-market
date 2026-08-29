import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { HAWALA_LEDGER_MODULE } from "../../../../../../modules/hawala-ledger"
import HawalaLedgerModuleService from "../../../../../../modules/hawala-ledger/service"

/**
 * GET /admin/hawala/orders/:id/lineage
 * Every ledger entry in the order's economic action (purchase, fee,
 * seller, invest, consignment legs), grouped by correlation, plus the
 * ACH transactions, payout requests and vendor payments that point back
 * at those entries.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const hawalaService = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)
  try {
    const lineage = await hawalaService.getOrderLineage(req.params.id)
    res.json(lineage)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to compute lineage"
    res.status(500).json({ error: message })
  }
}
