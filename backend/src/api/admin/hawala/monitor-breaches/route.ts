import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { HAWALA_LEDGER_MODULE } from "../../../../modules/hawala-ledger"
import HawalaLedgerModuleService from "../../../../modules/hawala-ledger/service"

/**
 * GET /admin/hawala/monitor-breaches
 * Breach history (edge-triggered: one row per false→true transition).
 * Lives beside /monitors rather than under it so the static path never
 * competes with the /monitors/:id dynamic segment.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const hawalaService = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)
  const { monitor_id, account_id, limit = "50", offset = "0" } = req.query

  const filters: Record<string, unknown> = {}
  if (monitor_id) filters.monitor_id = monitor_id
  if (account_id) filters.account_id = account_id

  const take = Math.min(Math.max(parseInt(limit as string) || 50, 1), 200)
  const skip = Math.max(parseInt(offset as string) || 0, 0)

  const breaches = await hawalaService.listMonitorBreaches(filters, {
    take,
    skip,
    order: { occurred_at: "DESC" },
  })
  res.json({ breaches, count: breaches.length, limit: take, offset: skip })
}
