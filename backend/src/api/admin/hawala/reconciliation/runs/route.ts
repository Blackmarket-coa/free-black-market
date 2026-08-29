import { createLogger } from "../../../../../shared/logger"
const log = createLogger("api/admin/hawala/reconciliation/runs")
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { HAWALA_LEDGER_MODULE } from "../../../../../modules/hawala-ledger"
import HawalaLedgerModuleService from "../../../../../modules/hawala-ledger/service"

/**
 * GET /admin/hawala/reconciliation/runs
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const hawalaService = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)
  const { upload_id, status, limit = "50", offset = "0" } = req.query

  const filters: Record<string, unknown> = {}
  if (upload_id) filters.upload_id = upload_id
  if (status) filters.status = status

  const take = Math.min(Math.max(parseInt(limit as string) || 50, 1), 100)
  const skip = Math.max(parseInt(offset as string) || 0, 0)

  const runs = await hawalaService.listReconciliationRuns(filters, { take, skip })
  res.json({ runs, count: runs.length, limit: take, offset: skip })
}

/**
 * POST /admin/hawala/reconciliation/runs
 * Start a reconciliation run. Body: { upload_id, rule_ids?, dry_run? }.
 * Runs synchronously (batches are small at this scale) and returns the
 * outcome. Start with dry_run: true to preview matches without
 * persisting anything.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const hawalaService = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)
  const body = req.body as {
    upload_id?: string
    rule_ids?: string[]
    dry_run?: boolean
  }

  if (!body.upload_id) {
    return res.status(400).json({ error: "upload_id is required" })
  }

  try {
    const outcome = await hawalaService.runExternalReconciliation({
      upload_id: body.upload_id,
      rule_ids: body.rule_ids,
      dry_run: body.dry_run,
    })
    res.status(201).json(outcome)
  } catch (error) {
    log.error("Error running reconciliation:", error)
    const message = error instanceof Error ? error.message : "Failed to run reconciliation"
    res.status(400).json({ error: message })
  }
}
