import { createLogger } from "../../../../../shared/logger"
const log = createLogger("api/admin/hawala/reconciliation/rules")
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { HAWALA_LEDGER_MODULE } from "../../../../../modules/hawala-ledger"
import HawalaLedgerModuleService from "../../../../../modules/hawala-ledger/service"
import { validateCriteria } from "../../../../../modules/hawala-ledger/external-reconciliation"

/**
 * GET /admin/hawala/reconciliation/rules
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const hawalaService = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)
  const rules = await hawalaService.listMatchingRules({})
  res.json({ rules, count: rules.length })
}

/**
 * POST /admin/hawala/reconciliation/rules
 * Body: { name, description?, criteria: MatchingCriterion[], is_active? }
 * Criteria are validated up front — an unknown kind is a 400 here, never
 * a silently-failing rule at match time.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const hawalaService = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)
  const body = req.body as {
    name?: string
    description?: string
    criteria?: unknown
    is_active?: boolean
  }

  if (!body.name?.trim()) {
    return res.status(400).json({ error: "name is required" })
  }

  try {
    const criteria = validateCriteria(body.criteria)
    const rule = await hawalaService.createMatchingRules({
      name: body.name.trim(),
      description: body.description ?? null,
      criteria: criteria as unknown as Record<string, unknown>,
      is_active: body.is_active ?? true,
    })
    res.status(201).json({ rule })
  } catch (error) {
    log.error("Error creating matching rule:", error)
    const message = error instanceof Error ? error.message : "Failed to create rule"
    res.status(400).json({ error: message })
  }
}
