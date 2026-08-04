import { createLogger } from "../../../../shared/logger"
const log = createLogger("api/store/hawala/deposit")
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { HAWALA_LEDGER_MODULE } from "../../../../modules/hawala-ledger"
import HawalaLedgerModuleService from "../../../../modules/hawala-ledger/service"
import { createStripeAchService } from "../../../../modules/hawala-ledger/stripe-ach"
import { requireCustomerId } from "../../../../shared"
import { resolveRequestIdempotencyKey } from "../../../../shared/request-idempotency"

/**
 * POST /store/hawala/deposit
 * Deposit funds via ACH from linked bank account
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

  const minDeposit = 10
  const maxDeposit = 10000
  if (amount < minDeposit || amount > maxDeposit) {
    return res.status(400).json({
      error: `Amount must be between $${minDeposit} and $${maxDeposit}`,
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

    // Validate required fields
    if (!bankAccount.stripe_payment_method_id || !bankAccount.ledger_account_id) {
      return res.status(400).json({ error: "Bank account is not fully configured" })
    }

    const achService = createStripeAchService()

    // Calculate fee
    const fee = achService.calculateFee(amount)
    const netAmount = amount - fee

    // Capture the real client IP + user agent for the NACHA mandate record.
    const ipAddress =
      (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ||
      req.socket?.remoteAddress ||
      undefined
    const userAgent = (req.headers["user-agent"] as string | undefined) || undefined

    // Create ACH deposit.
    // The key reaches Stripe below, before anything is written to the ledger,
    // so it has to be stable across retries — a fresh key per attempt meant a
    // retried request pulled from the customer's bank a second time.
    const { key: idempotencyKey, source: idempotencySource } =
      resolveRequestIdempotencyKey({
        scope: "deposit",
        actorId: customerId,
        headers: req.headers,
        body: req.body,
        payload: { bank_account_id, amount },
      })
    if (idempotencySource === "derived") {
      log.warn(
        "[POST /store/hawala/deposit] no Idempotency-Key sent; derived one from the payload. Clients should send the header."
      )
    }
    const depositResult = await achService.createAchDeposit({
      stripeCustomerId: bankAccount.stripe_customer_id,
      paymentMethodId: bankAccount.stripe_payment_method_id,
      amount,
      ledgerAccountId: bankAccount.ledger_account_id,
      idempotencyKey,
      ipAddress,
      userAgent,
    })

    // Create ACH transaction record
    const achTransaction = await hawalaService.createAchTransactions({
      bank_account_id: bank_account_id,
      ledger_account_id: bankAccount.ledger_account_id,
      transaction_type: "DEPOSIT" as const,
      amount: amount,
      stripe_fee: fee,
      net_amount: netAmount,
      currency_code: "USD",
      stripe_payment_intent_id: depositResult.paymentIntentId,
      status: depositResult.status === "succeeded" ? "SUCCEEDED" : "PENDING",
    })

    // If payment succeeded immediately, credit the ledger
    if (depositResult.status === "succeeded") {
      await hawalaService.recordDeposit({
        credit_account_id: bankAccount.ledger_account_id,
        amount: netAmount,
        stripe_payment_intent_id: depositResult.paymentIntentId,
        fee,
        idempotency_key: `ledger-${idempotencyKey}`,
      })

      await hawalaService.updateAchTransactions({
        id: achTransaction.id,
        status: "SUCCEEDED" as const,
        actual_settlement_date: new Date(),
      })
    }

    res.status(201).json({
      transaction: achTransaction,
      stripe_status: depositResult.status,
      amount,
      fee,
      net_amount: netAmount,
      message: depositResult.status === "processing"
        ? "ACH transfer initiated. Funds will be available in 2-3 business days."
        : "Deposit completed successfully.",
    })
  } catch (error) {
    log.error("Error processing deposit:", error)
    res.status(500).json({ error: "Failed to process deposit" })
  }
}
