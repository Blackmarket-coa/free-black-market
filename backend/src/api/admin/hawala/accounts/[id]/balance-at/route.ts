import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { HAWALA_LEDGER_MODULE } from "../../../../../../modules/hawala-ledger"
import HawalaLedgerModuleService from "../../../../../../modules/hawala-ledger/service"

/**
 * GET /admin/hawala/accounts/:id/balance-at?timestamp=<ISO 8601>
 * Point-in-time balance replayed from the entry log (no snapshot table
 * needed at current scale). Defaults to now, which doubles as a drift
 * cross-check against the cached balance.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const hawalaService = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)
  const timestamp = (req.query.timestamp as string) || new Date().toISOString()

  try {
    const result = await hawalaService.getBalanceAt(req.params.id, timestamp)
    res.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to compute balance"
    const status = message.includes("Invalid timestamp") ? 400 : 500
    res.status(status).json({ error: message })
  }
}
