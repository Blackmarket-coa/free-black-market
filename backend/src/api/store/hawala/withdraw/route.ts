import { createLogger } from "../../../../shared/logger"
const log = createLogger("api/store/hawala/withdraw")
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { HAWALA_LEDGER_MODULE } from "../../../../modules/hawala-ledger"
import HawalaLedgerModuleService from "../../../../modules/hawala-ledger/service"
import {
  createStripeAchService,
  isAchPayoutConfigured,
} from "../../../../modules/hawala-ledger/stripe-ach"
import { requireCustomerId } from "../../../../shared"
import { resolveRequestIdempotencyKey } from "../../../../shared/request-idempotency"

/**
 * POST /store/hawala/withdraw
 * Withdraw funds via ACH to a linked, verified bank account.
 *
 * Money-integrity contract: the customer's ledger balance is NEVER debited
 * unless a Stripe payout is actually executed. If outbound ACH payouts are not
 * configured (`isAchPayoutConfigured()`), the route fails closed with 503 and
 * moves no money — rather than debiting the balance and reporting a payout that
 * never happens. When configured, the payout runs first and the ledger debit is
 * recorded only after the payout succeeds.
 */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const hawalaService = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)

  const customerId = requireCustomerId(req, res)
  if (!customerId) return

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

  // Fail closed: never debit a balance we can't actually pay out. When ACH
  // payouts aren't wired (no Stripe key / not explicitly enabled), the
  // withdrawal path is unavailable and no ledger movement occurs.
  if (!isAchPayoutConfigured()) {
    log.warn("Withdrawal requested but ACH payouts are not configured", {
      customer_id: customerId,
    })
    return res.status(503).json({
      error: "Withdrawals are temporarily unavailable",
    })
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

    if (!bankAccount.ledger_account_id) {
      return res.status(400).json({ error: "Bank account is not linked to a wallet" })
    }

    // A payout destination (Stripe external/bank account id) is required to
    // actually push funds. Without it we cannot execute a payout, so we do not
    // debit anything.
    if (!bankAccount.stripe_bank_account_id) {
      return res.status(400).json({ error: "Bank account is not configured for payouts" })
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
    // Stable across retries: this key is handed to the Stripe payout below
    // before the ledger debit is recorded, so a fresh key per attempt meant a
    // retried request pushed a second real payout.
    const { key: idempotencyKey, source: idempotencySource } =
      resolveRequestIdempotencyKey({
        scope: "withdraw",
        actorId: customerId,
        headers: req.headers,
        body: req.body,
        payload: { bank_account_id, amount },
      })
    if (idempotencySource === "derived") {
      log.warn(
        "[POST /store/hawala/withdraw] no Idempotency-Key sent; derived one from the payload. Clients should send the header."
      )
    }

    // Record the intent up front so a failed/returned payout is auditable.
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

    // Execute the payout FIRST. If it fails, mark the transaction failed and
    // return an error WITHOUT debiting the customer's ledger balance.
    let payout: { payoutId: string; status: string; arrivalDate: Date }
    try {
      payout = await achService.createAchPayout({
        amount: netAmount,
        destination: bankAccount.stripe_bank_account_id,
        ledgerAccountId: bankAccount.ledger_account_id,
        idempotencyKey,
      })
    } catch (payoutError) {
      log.error("ACH payout failed; ledger not debited", payoutError)
      await hawalaService.updateAchTransactions({
        id: achTransaction.id,
        status: "FAILED" as const,
        failure_reason:
          payoutError instanceof Error ? payoutError.message : "payout_failed",
        failed_at: new Date(),
      })
      return res.status(502).json({ error: "Failed to process withdrawal payout" })
    }

    // Payout succeeded — now debit the ledger (atomic CAS) and finalize the
    // transaction with the real Stripe payout reference.
    await hawalaService.recordWithdrawal({
      debit_account_id: bankAccount.ledger_account_id,
      amount: amount,
      stripe_transfer_id: payout.payoutId,
      fee,
      idempotency_key: `ledger-${idempotencyKey}`,
    })

    const updatedTransaction = await hawalaService.updateAchTransactions({
      id: achTransaction.id,
      status: "PROCESSING" as const,
      stripe_transfer_id: payout.payoutId,
      // The payout.paid / payout.failed webhook joins on `stripe_payout_id`.
      // Writing only `stripe_transfer_id` meant it could never match a row, so
      // a failed payout never triggered its compensating refund and the
      // customer stayed debited against money that had bounced.
      stripe_payout_id: payout.payoutId,
      expected_settlement_date: payout.arrivalDate,
    })

    res.status(201).json({
      transaction: updatedTransaction,
      amount,
      fee,
      net_amount: netAmount,
      payout_id: payout.payoutId,
      message: "Withdrawal initiated. Funds will arrive in 2-3 business days.",
    })
  } catch (error) {
    log.error("Error processing withdrawal:", error)
    res.status(500).json({ error: "Failed to process withdrawal" })
  }
}
