import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { createLogger } from "../../../../../shared/logger"
import { HAWALA_LEDGER_MODULE } from "../../../../../modules/hawala-ledger"
import HawalaLedgerModuleService from "../../../../../modules/hawala-ledger/service"
import { createStripeAchService } from "../../../../../modules/hawala-ledger/stripe-ach"

const log = createLogger("api/store/hawala/bank-accounts/link")

/**
 * POST /store/hawala/bank-accounts/link
 * Complete bank account linking from Financial Connections
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const hawalaService = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)

  const customerId = (req as any).auth_context?.actor_id
  if (!customerId) {
    return res.status(401).json({ error: "Authentication required" })
  }

  const { stripe_customer_id, financial_connections_account_id } = req.body as {
    stripe_customer_id: string
    financial_connections_account_id: string
  }

  if (!stripe_customer_id || !financial_connections_account_id) {
    return res.status(400).json({
      error: "stripe_customer_id and financial_connections_account_id are required",
    })
  }

  try {
    const achService = createStripeAchService()

    // Create payment method from Financial Connections account
    const result = await achService.createBankAccountFromConnection({
      stripeCustomerId: stripe_customer_id,
      financialConnectionsAccountId: financial_connections_account_id,
    })

    // Get customer's wallet
    const wallets = await hawalaService.listLedgerAccounts({
      account_type: "USER_WALLET",
      owner_type: "CUSTOMER",
      owner_id: customerId,
    })

    let walletId = wallets.length > 0 ? wallets[0].id : null
    if (!walletId) {
      const wallet = await hawalaService.createAccount({
        account_type: "USER_WALLET",
        owner_type: "CUSTOMER",
        owner_id: customerId,
      })
      walletId = wallet.id
    }

    // Save bank account to ledger
    const bankAccount = await hawalaService.createBankAccounts({
      owner_type: "CUSTOMER" as const,
      owner_id: customerId,
      ledger_account_id: walletId,
      stripe_customer_id: stripe_customer_id,
      stripe_bank_account_id: result.paymentMethodId,
      stripe_payment_method_id: result.paymentMethodId,
      bank_name: result.bankName,
      last_four: result.last4,
      account_type: "CHECKING" as const,
      verification_status: "VERIFIED" as const,
      is_default: true,
    })

    res.status(201).json({ bank_account: bankAccount })
  } catch (error) {
    // Logged here, not echoed: a Stripe or database error message is internal
    // detail, and the storefront now surfaces a `{ error }` string verbatim.
    log.error("Error completing bank account link:", error)
    res.status(500).json({ error: "Failed to link bank account" })
  }
}
