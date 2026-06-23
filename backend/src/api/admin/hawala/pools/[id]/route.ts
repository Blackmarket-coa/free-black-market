import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { HAWALA_LEDGER_MODULE } from "../../../../../modules/hawala-ledger"
import HawalaLedgerModuleService from "../../../../../modules/hawala-ledger/service"

/**
 * GET /admin/hawala/pools/:id
 * Get investment pool details
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const hawalaService = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)
  const { id } = req.params

  try {
    const pool = await hawalaService.retrieveInvestmentPool(id)
    if (!pool) {
      return res.status(404).json({ error: "Investment pool not found" })
    }

    // Get pool balance
    const balance = await hawalaService.getAccountBalance(pool.ledger_account_id)

    // Get investments
    const investments = await hawalaService.listInvestments({
      pool_id: id,
    })

    res.json({ pool, balance, investments })
  } catch (error) {
    res.status(500).json({ error: (error as Error).message })
  }
}

/**
 * PATCH /admin/hawala/pools/:id
 * Update investment pool
 */
export async function PATCH(req: MedusaRequest, res: MedusaResponse) {
  const hawalaService = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)
  const { id } = req.params

  const {
    name,
    description,
    status,
    target_amount,
    auto_invest_enabled,
    auto_invest_percentage,
    metadata,
  } = req.body as {
    name?: string
    description?: string
    status?: string
    target_amount?: number
    auto_invest_enabled?: boolean
    auto_invest_percentage?: number
    metadata?: Record<string, unknown>
  }

  try {
    const updateData: Record<string, unknown> = { id }
    if (name) updateData.name = name
    if (description !== undefined) updateData.description = description
    if (status) updateData.status = status
    if (target_amount) updateData.target_amount = target_amount
    if (auto_invest_enabled !== undefined) updateData.auto_invest_enabled = auto_invest_enabled
    if (auto_invest_percentage !== undefined) updateData.auto_invest_percentage = auto_invest_percentage
    if (metadata) updateData.metadata = metadata

    const pool = await hawalaService.updateInvestmentPools(updateData)

    res.json({ pool })
  } catch (error) {
    res.status(500).json({ error: (error as Error).message })
  }
}
