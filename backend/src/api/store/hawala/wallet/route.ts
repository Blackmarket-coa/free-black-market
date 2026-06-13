import { createLogger } from "../../../../shared/logger"
const log = createLogger("api/store/hawala/wallet")
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { HAWALA_LEDGER_MODULE } from "../../../../modules/hawala-ledger"
import HawalaLedgerModuleService from "../../../../modules/hawala-ledger/service"

/**
 * GET /store/hawala/wallet
 * Get customer's wallet account and balance
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const hawalaService = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)

  // Get customer ID from auth context
  const customerId = (req as any).auth_context?.actor_id
  if (!customerId) {
    return res.status(401).json({ error: "Authentication required" })
  }

  try {
    // Find or create wallet for customer
    let wallets = await hawalaService.listLedgerAccounts({
      account_type: "USER_WALLET",
      owner_type: "CUSTOMER",
      owner_id: customerId,
    })

    if (wallets.length === 0) {
      // Create wallet for customer
      const wallet = await hawalaService.createAccount({
        account_type: "USER_WALLET",
        owner_type: "CUSTOMER",
        owner_id: customerId,
      })
      wallets = [wallet]
    }

    const wallet = wallets[0]
    const balance = await hawalaService.getAccountBalance(wallet.id)

    res.json({ wallet, balance })
  } catch (error) {
    log.error("Error getting wallet:", error)
    res.status(500).json({ error: "Failed to retrieve wallet" })
  }
}

/**
 * POST /store/hawala/wallet
 * Create a customer wallet (if not exists)
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const hawalaService = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)

  const customerId = (req as any).auth_context?.actor_id
  if (!customerId) {
    return res.status(401).json({ error: "Authentication required" })
  }

  try {
    // Check if wallet exists
    const existing = await hawalaService.listLedgerAccounts({
      account_type: "USER_WALLET",
      owner_type: "CUSTOMER",
      owner_id: customerId,
    })

    if (existing.length > 0) {
      const balance = await hawalaService.getAccountBalance(existing[0].id)
      return res.json({ wallet: existing[0], balance, created: false })
    }

    // Create new wallet
    const wallet = await hawalaService.createAccount({
      account_type: "USER_WALLET",
      owner_type: "CUSTOMER",
      owner_id: customerId,
    })

    const balance = await hawalaService.getAccountBalance(wallet.id)

    res.status(201).json({ wallet, balance, created: true })
  } catch (error) {
    log.error("Error creating wallet:", error)
    res.status(500).json({ error: "Failed to create wallet" })
  }
}
