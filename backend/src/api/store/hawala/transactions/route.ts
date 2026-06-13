import { createLogger } from "../../../../shared/logger"
const log = createLogger("api/store/hawala/transactions")
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { HAWALA_LEDGER_MODULE } from "../../../../modules/hawala-ledger"
import HawalaLedgerModuleService from "../../../../modules/hawala-ledger/service"

/**
 * GET /store/hawala/transactions
 * Get customer's transaction history
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const hawalaService = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)

  const customerId = (req as any).auth_context?.actor_id
  if (!customerId) {
    return res.status(401).json({ error: "Authentication required" })
  }

  const { limit = "50", offset = "0", entry_type } = req.query

  try {
    // Get customer's wallet
    const wallets = await hawalaService.listLedgerAccounts({
      account_type: "USER_WALLET",
      owner_type: "CUSTOMER",
      owner_id: customerId,
    })

    if (wallets.length === 0) {
      return res.json({ transactions: [], count: 0 })
    }

    const transactions = await hawalaService.getTransactionHistory(wallets[0].id, {
      limit: parseInt(limit as string),
      offset: parseInt(offset as string),
      entry_type: entry_type as string,
    })

    res.json({
      transactions,
      count: transactions.length,
      limit: parseInt(limit as string),
      offset: parseInt(offset as string),
    })
  } catch (error) {
    log.error("Error getting transactions:", error)
    res.status(500).json({ error: "Failed to retrieve transactions" })
  }
}
