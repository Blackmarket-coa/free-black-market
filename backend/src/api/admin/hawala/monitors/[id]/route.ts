import { createLogger } from "../../../../../shared/logger"
const log = createLogger("api/admin/hawala/monitors/[id]")
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { HAWALA_LEDGER_MODULE } from "../../../../../modules/hawala-ledger"
import HawalaLedgerModuleService from "../../../../../modules/hawala-ledger/service"
import {
  isMonitorField,
  normalizeOperator,
} from "../../../../../modules/hawala-ledger/monitor-evaluator"

/**
 * GET /admin/hawala/monitors/:id
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const hawalaService = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)
  try {
    const monitor = await hawalaService.retrieveBalanceMonitor(req.params.id)
    res.json({ monitor })
  } catch {
    res.status(404).json({ error: "Monitor not found" })
  }
}

/**
 * PUT /admin/hawala/monitors/:id
 * Operator and field changes are re-validated/normalized; a threshold
 * change takes effect on the next evaluation (thresholds are already
 * stored in cents — nothing derived needs recomputing).
 */
export async function PUT(req: MedusaRequest, res: MedusaResponse) {
  const hawalaService = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)
  const body = req.body as {
    field?: string
    operator?: string
    threshold_cents?: number
    severity?: string
    description?: string
    is_active?: boolean
  }

  try {
    const update: Record<string, unknown> = { id: req.params.id }
    if (body.field !== undefined) {
      if (!isMonitorField(body.field)) {
        return res.status(400).json({ error: `Unknown monitor field ${body.field}` })
      }
      update.field = body.field
    }
    if (body.operator !== undefined) update.operator = normalizeOperator(body.operator)
    if (body.threshold_cents !== undefined) {
      if (!Number.isInteger(body.threshold_cents)) {
        return res.status(400).json({ error: "threshold_cents must be an integer" })
      }
      update.threshold_cents = body.threshold_cents
    }
    if (body.severity !== undefined) update.severity = body.severity
    if (body.description !== undefined) update.description = body.description
    if (body.is_active !== undefined) update.is_active = body.is_active

    const monitor = await hawalaService.updateBalanceMonitors(
      update as Parameters<HawalaLedgerModuleService["updateBalanceMonitors"]>[0]
    )
    res.json({ monitor })
  } catch (error) {
    log.error("Error updating balance monitor:", error)
    const message = error instanceof Error ? error.message : "Failed to update monitor"
    res.status(400).json({ error: message })
  }
}

/**
 * DELETE /admin/hawala/monitors/:id (soft delete)
 */
export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const hawalaService = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)
  try {
    await hawalaService.softDeleteBalanceMonitors([req.params.id])
    res.json({ id: req.params.id, deleted: true })
  } catch (error) {
    log.error("Error deleting balance monitor:", error)
    const message = error instanceof Error ? error.message : "Failed to delete monitor"
    res.status(400).json({ error: message })
  }
}
