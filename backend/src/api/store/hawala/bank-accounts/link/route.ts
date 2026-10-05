import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { createLogger } from "../../../../../shared/logger"
import { actorId, forbidden } from "../../../../../shared/community-read-access"
import { HAWALA_LEDGER_MODULE } from "../../../../../modules/hawala-ledger"
import HawalaLedgerModuleService from "../../../../../modules/hawala-ledger/service"
import { createStripeAchService } from "../../../../../modules/hawala-ledger/stripe-ach"

const log = createLogger("api/store/hawala/bank-accounts/link")

/**
 * POST /store/hawala/bank-accounts/link
 * Complete bank account linking from Financial Connections.
 *
 * The Stripe customer is derived on the server from the signed-in customer
 * (the one `POST /store/hawala/bank-accounts` created and tagged with
 * `metadata.medusa_customer_id`), never taken from the request. It used to be
 * read from the body, so a signed-in customer could attach a bank account
 * under any Stripe customer id they could name (SD-34). A body
 * `stripe_customer_id` is still accepted for old clients but must match.
 * The Financial Connections account must also be held by that same Stripe
 * customer before a payment method is created from it.
 *
 * Every refusal is `forbidden()` with one body: whether the caller has no
 * Stripe customer, named someone else's, or brought an account they do not
 * hold, the response says nothing about which.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const customerId = actorId(req)
  if (!customerId) {
    return res.status(401).json({ error: "Authentication required" })
  }

  const body = (req.body ?? {}) as {
    stripe_customer_id?: unknown
    financial_connections_account_id?: unknown
  }
  const financialConnectionsAccountId = body.financial_connections_account_id
  if (typeof financialConnectionsAccountId !== "string" || financialConnectionsAccountId.length === 0) {
    return res.status(400).json({ error: "financial_connections_account_id is required" })
  }

  const hawalaService = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)

  try {
    const achService = createStripeAchService()

    const stripeCustomerId = await achService.findCustomerIdFor(customerId)
    if (!stripeCustomerId) {
      log.warn(`[bank-accounts/link] customer ${customerId} has no FBM-created Stripe customer`)
      return forbidden(res)
    }
    if (body.stripe_customer_id !== undefined && body.stripe_customer_id !== stripeCustomerId) {
      log.warn(`[bank-accounts/link] customer ${customerId} named a Stripe customer that is not theirs`)
      return forbidden(res)
    }

    const holder = await achService.financialConnectionsAccountHolder(financialConnectionsAccountId)
    if (holder !== stripeCustomerId) {
      log.warn(`[bank-accounts/link] customer ${customerId} brought a Financial Connections account they do not hold`)
      return forbidden(res)
    }

    // Create payment method from Financial Connections account
    const result = await achService.createBankAccountFromConnection({
      stripeCustomerId,
      financialConnectionsAccountId,
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
      stripe_customer_id: stripeCustomerId,
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
