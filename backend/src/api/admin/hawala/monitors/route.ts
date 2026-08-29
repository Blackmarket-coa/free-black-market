import { createLogger } from "../../../../shared/logger"
const log = createLogger("api/admin/hawala/monitors")
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { HAWALA_LEDGER_MODULE } from "../../../../modules/hawala-ledger"
import HawalaLedgerModuleService from "../../../../modules/hawala-ledger/service"

/**
 * GET /admin/hawala/monitors
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const hawalaService = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)
  const { account_id, is_active } = req.query
  const filters: Record<string, unknown> = {}
  if (account_id) filters.account_id = account_id
  if (is_active !== undefined) filters.is_active = is_active === "true"

  const monitors = await hawalaService.listBalanceMonitors(filters)
  res.json({ monitors, count: monitors.length })
}

/**
 * POST /admin/hawala/monitors
 * Body: { account_id, field?, operator, threshold_cents, severity?, description? }
 * Operator "=" is accepted and normalized to "==". Zero thresholds are
 * valid ("alert when the settlement balance reaches 0").
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const hawalaService = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)
  const body = req.body as {
    account_id?: string
    field?: string
    operator?: string
    threshold_cents?: number
    severity?: "low" | "medium" | "high" | "critical"
    description?: string
  }

  if (!body.account_id || !body.operator || body.threshold_cents === undefined) {
    return res
      .status(400)
      .json({ error: "account_id, operator and threshold_cents are required" })
  }

  try {
    const monitor = await hawalaService.createBalanceMonitor({
      account_id: body.account_id,
      field: body.field,
      operator: body.operator,
      threshold_cents: body.threshold_cents,
      severity: body.severity,
      description: body.description,
    })
    res.status(201).json({ monitor })
  } catch (error) {
    log.error("Error creating balance monitor:", error)
    const message = error instanceof Error ? error.message : "Failed to create monitor"
    res.status(400).json({ error: message })
  }
}
