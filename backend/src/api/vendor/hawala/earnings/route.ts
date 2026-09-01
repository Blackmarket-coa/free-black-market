import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { HAWALA_LEDGER_MODULE } from "../../../../modules/hawala-ledger"
import HawalaLedgerModuleService from "../../../../modules/hawala-ledger/service"
import { resolveVendorSellerId } from "../seller-context"

/**
 * GET /vendor/hawala/earnings
 * Get vendor's earnings account and balance
 *
 * OPTIMIZED: Parallel data fetching for balance and transactions
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const hawalaService = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)

  // Get vendor/seller ID from auth context
  const sellerId = await resolveVendorSellerId(req)
  if (!sellerId) {
    return res.status(401).json({ error: "Authentication required" })
  }

  try {
    // Find or create earnings account for seller
    let accounts = await hawalaService.listLedgerAccounts({
      account_type: "SELLER_EARNINGS",
      owner_type: "SELLER",
      owner_id: sellerId,
    })

    if (accounts.length === 0) {
      // Create earnings account for seller
      const account = await hawalaService.createAccount({
        account_type: "SELLER_EARNINGS",
        owner_type: "SELLER",
        owner_id: sellerId,
      })
      accounts = [account]
    }

    const account = accounts[0]

    // OPTIMIZATION: Fetch balance and transactions in parallel
    const [balance, transactions] = await Promise.all([
      hawalaService.getAccountBalance(account.id),
      hawalaService.getTransactionHistory(account.id, { limit: 20 }),
    ])

    res.json({ account, balance, recent_transactions: transactions })
  } catch (error) {
    res.status(500).json({ error: (error as Error).message })
  }
}
