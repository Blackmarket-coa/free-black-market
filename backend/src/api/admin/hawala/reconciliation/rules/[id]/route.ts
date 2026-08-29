import { createLogger } from "../../../../../../shared/logger"
const log = createLogger("api/admin/hawala/reconciliation/rules/[id]")
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { HAWALA_LEDGER_MODULE } from "../../../../../../modules/hawala-ledger"
import HawalaLedgerModuleService from "../../../../../../modules/hawala-ledger/service"
import { validateCriteria } from "../../../../../../modules/hawala-ledger/external-reconciliation"

/**
 * GET /admin/hawala/reconciliation/rules/:id
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const hawalaService = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)
  try {
    const rule = await hawalaService.retrieveMatchingRule(req.params.id)
    res.json({ rule })
  } catch {
    res.status(404).json({ error: "Rule not found" })
  }
}

/**
 * PUT /admin/hawala/reconciliation/rules/:id
 * Criteria, when supplied, are re-validated in full (no partial merges —
 * the whole array replaces the old one, so a rule can never hold a mix
 * of validated and unvalidated criteria).
 */
export async function PUT(req: MedusaRequest, res: MedusaResponse) {
  const hawalaService = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)
  const body = req.body as {
    name?: string
    description?: string
    criteria?: unknown
    is_active?: boolean
  }

  try {
    const update: {
      id: string
      name?: string
      description?: string | null
      criteria?: Record<string, unknown>
      is_active?: boolean
    } = { id: req.params.id }
    if (body.name !== undefined) update.name = body.name.trim()
    if (body.description !== undefined) update.description = body.description
    if (body.is_active !== undefined) update.is_active = body.is_active
    if (body.criteria !== undefined) {
      update.criteria = validateCriteria(body.criteria) as unknown as Record<string, unknown>
    }

    const rule = await hawalaService.updateMatchingRules(update)
    res.json({ rule })
  } catch (error) {
    log.error("Error updating matching rule:", error)
    const message = error instanceof Error ? error.message : "Failed to update rule"
    res.status(400).json({ error: message })
  }
}

/**
 * DELETE /admin/hawala/reconciliation/rules/:id (soft delete)
 */
export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const hawalaService = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)
  try {
    await hawalaService.softDeleteMatchingRules([req.params.id])
    res.json({ id: req.params.id, deleted: true })
  } catch (error) {
    log.error("Error deleting matching rule:", error)
    const message = error instanceof Error ? error.message : "Failed to delete rule"
    res.status(400).json({ error: message })
  }
}
