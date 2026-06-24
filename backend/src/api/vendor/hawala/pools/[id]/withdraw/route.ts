import { createLogger } from "../../../../../../shared/logger"
import type { VendorRequest } from "../../../../types"
const log = createLogger("api/vendor/hawala/pools/[id]/withdraw")
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { randomUUID } from "crypto"
import { HAWALA_LEDGER_MODULE } from "../../../../../../modules/hawala-ledger"
import HawalaLedgerModuleService from "../../../../../../modules/hawala-ledger/service"
import { withdrawPoolSchema, validateInput } from "../../../../../hawala-validation"

/**
 * POST /vendor/hawala/pools/:id/withdraw
 * Withdraw funds from pool to vendor earnings
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const hawalaService = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)
  const { id } = req.params

  const sellerId = (req as VendorRequest).auth_context?.actor_id
  if (!sellerId) {
    return res.status(401).json({ error: "Authentication required" })
  }

  // Validate input
  const validation = validateInput(withdrawPoolSchema, req.body)
  if (!validation.success) {
    return res.status(400).json({ error: validation.error })
  }
  const { amount, description } = validation.data

  try {
    const pool = await hawalaService.retrieveInvestmentPool(id)
    if (!pool) {
      return res.status(404).json({ error: "Pool not found" })
    }

    if (pool.producer_id !== sellerId) {
      return res.status(403).json({ error: "Access denied" })
    }

    // Check pool balance
    const poolBalance = await hawalaService.getAccountBalance(pool.ledger_account_id)
    if (poolBalance.available_balance < amount) {
      return res.status(400).json({
        error: `Insufficient pool balance. Available: $${poolBalance.available_balance.toFixed(2)}`,
      })
    }

    // Get or create seller earnings account
    let earningsAccounts = await hawalaService.listLedgerAccounts({
      account_type: "SELLER_EARNINGS",
      owner_type: "SELLER",
      owner_id: sellerId,
    })

    if (earningsAccounts.length === 0) {
      const account = await hawalaService.createAccount({
        account_type: "SELLER_EARNINGS",
        owner_type: "SELLER",
        owner_id: sellerId,
      })
      earningsAccounts = [account]
    }

    // Transfer from pool to earnings - use UUID for idempotency
    const entry = await hawalaService.createTransfer({
      debit_account_id: pool.ledger_account_id,
      credit_account_id: earningsAccounts[0].id,
      amount,
      entry_type: "WITHDRAWAL",
      description: description || "Pool withdrawal to earnings",
      investment_pool_id: id,
      idempotency_key: `pool-withdraw-${id}-${randomUUID()}`,
    })

    res.json({
      success: true,
      entry,
      message: `$${amount.toFixed(2)} transferred to earnings account`,
    })
  } catch (error) {
    log.error("Error withdrawing from pool:", error)
    res.status(400).json({ error: "Failed to process withdrawal" })
  }
}
