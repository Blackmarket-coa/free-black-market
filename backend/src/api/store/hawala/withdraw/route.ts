import { createLogger } from "../../../../shared/logger"
const log = createLogger("api/store/hawala/withdraw")
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { HAWALA_LEDGER_MODULE } from "../../../../modules/hawala-ledger"
import HawalaLedgerModuleService from "../../../../modules/hawala-ledger/service"
import { createStripeAchService } from "../../../../modules/hawala-ledger/stripe-ach"

/**
 * POST /store/hawala/withdraw
 * Withdraw funds via ACH to linked bank account
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const hawalaService = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)

  const customerId = (req as any).auth_context?.actor_id
  if (!customerId) {
    return res.status(401).json({ error: "Authentication required" })
  }

  const { bank_account_id, amount } = req.body as {
    bank_account_id: string
    amount: number
  }

  if (!bank_account_id || !amount) {
    return res.status(400).json({ error: "bank_account_id and amount are required" })
  }

  if (amount <= 0) {
    return res.status(400).json({ error: "Amount must be positive" })
  }

  const minWithdraw = 10
  if (amount < minWithdraw) {
    return res.status(400).json({ error: `Minimum withdrawal is $${minWithdraw}` })
  }

  try {
    // Get bank account
    const bankAccount = await hawalaService.retrieveBankAccount(bank_account_id)
    if (!bankAccount || bankAccount.owner_id !== customerId) {
      return res.status(404).json({ error: "Bank account not found" })
    }

    if (bankAccount.verification_status !== "VERIFIED") {
      return res.status(400).json({ error: "Bank account is not verified" })
    }

    // Validate required fields
    if (!bankAccount.ledger_account_id) {
      return res.status(400).json({ error: "Bank account is not linked to a wallet" })
    }

    // Check balance
    const balance = await hawalaService.getAccountBalance(bankAccount.ledger_account_id)
    if (balance.available_balance < amount) {
      return res.status(400).json({
        error: `Insufficient balance. Available: $${balance.available_balance.toFixed(2)}`,
      })
    }

    const achService = createStripeAchService()

    // No fee on withdrawals (or you could add one)
    const fee = 0
    const netAmount = amount - fee

    // Note: In production, you'd need to set up Stripe Connect or use payouts
    // For now, we'll record the withdrawal intent and process manually
    const idempotencyKey = `withdraw-${customerId}-${Date.now()}`

    // Create ACH transaction record
    const achTransaction = await hawalaService.createAchTransactions({
      bank_account_id: bank_account_id,
      ledger_account_id: bankAccount.ledger_account_id,
      transaction_type: "WITHDRAWAL" as const,
      amount: amount,
      stripe_fee: fee,
      net_amount: netAmount,
      currency_code: "USD",
      status: "PENDING" as const,
    })

    // Debit the ledger account (put in pending)
    await hawalaService.recordWithdrawal({
      debit_account_id: bankAccount.ledger_account_id,
      amount: amount,
      stripe_transfer_id: achTransaction.id, // Use transaction ID as reference
      fee,
      idempotency_key: `ledger-${idempotencyKey}`,
    })

    res.status(201).json({
      transaction: achTransaction,
      amount,
      fee,
      net_amount: netAmount,
      message: "Withdrawal initiated. Funds will arrive in 2-3 business days.",
    })
  } catch (error) {
    log.error("Error processing withdrawal:", error)
    res.status(500).json({ error: "Failed to process withdrawal" })
  }
}
