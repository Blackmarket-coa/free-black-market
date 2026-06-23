import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { HAWALA_LEDGER_MODULE } from "../../../../../modules/hawala-ledger"
import HawalaLedgerModuleService from "../../../../../modules/hawala-ledger/service"

/**
 * GET /admin/hawala/accounts/:id
 * Get account details with balance
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const hawalaService = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)
  const { id } = req.params

  try {
    const account = await hawalaService.retrieveLedgerAccount(id)
    if (!account) {
      return res.status(404).json({ error: "Account not found" })
    }

    const balance = await hawalaService.getAccountBalance(id)

    res.json({ account, balance })
  } catch (error) {
    res.status(500).json({ error: (error as Error).message })
  }
}

/**
 * PATCH /admin/hawala/accounts/:id
 * Update account status or metadata
 */
export async function PATCH(req: MedusaRequest, res: MedusaResponse) {
  const hawalaService = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)
  const { id } = req.params

  const { status, stellar_address, metadata } = req.body as {
    status?: string
    stellar_address?: string
    metadata?: Record<string, unknown>
  }

  try {
    const updateData: Record<string, unknown> = { id }
    if (status) updateData.status = status
    if (stellar_address) updateData.stellar_address = stellar_address
    if (metadata) updateData.metadata = metadata

    const account = await hawalaService.updateLedgerAccounts(updateData)

    res.json({ account })
  } catch (error) {
    res.status(500).json({ error: (error as Error).message })
  }
}
