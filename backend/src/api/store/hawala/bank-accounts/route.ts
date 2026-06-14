import { createLogger } from "../../../../shared/logger"
const log = createLogger("api/store/hawala/bank-accounts")
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { HAWALA_LEDGER_MODULE } from "../../../../modules/hawala-ledger"
import HawalaLedgerModuleService from "../../../../modules/hawala-ledger/service"
import { createStripeAchService } from "../../../../modules/hawala-ledger/stripe-ach"
import { linkBankAccountSchema, validateInput } from "../../../hawala-validation"
import { requireCustomerId } from "../../../../shared"

/**
 * GET /store/hawala/bank-accounts
 * List customer's linked bank accounts
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const hawalaService = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)

  const customerId = requireCustomerId(req, res)
  if (!customerId) return

  try {
    const bankAccounts = await hawalaService.listBankAccounts({
      customer_id: customerId,
    })

    res.json({ bank_accounts: bankAccounts })
  } catch (error) {
    log.error("Error listing bank accounts:", error)
    res.status(500).json({ error: "Failed to retrieve bank accounts" })
  }
}

/**
 * POST /store/hawala/bank-accounts
 * Start bank account linking process
 */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const hawalaService = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)

  const customerId = requireCustomerId(req, res)
  if (!customerId) return

  // Validate input
  const validation = validateInput(linkBankAccountSchema, req.body)
  if (!validation.success) {
    return res.status(400).json({ error: validation.error })
  }
  const { email, name, return_url, method } = validation.data

  try {
    const achService = createStripeAchService()

    // Get or create Stripe customer
    const stripeCustomerId = await achService.getOrCreateCustomer({
      customerId,
      email,
      name,
    })

    // Store or update Stripe customer ID
    const _existingAccounts = await hawalaService.listBankAccounts({
      customer_id: customerId,
    })

    if (method === "financial_connections" || !method) {
      // Create Financial Connections session
      const session = await achService.createBankLinkSession({
        stripeCustomerId,
        returnUrl: return_url,
      })

      res.json({
        method: "financial_connections",
        client_secret: session.clientSecret,
        session_id: session.sessionId,
        stripe_customer_id: stripeCustomerId,
      })
    } else {
      // Manual method - return Stripe customer ID for form submission
      res.json({
        method: "manual",
        stripe_customer_id: stripeCustomerId,
        message: "Submit bank details to /store/hawala/bank-accounts/manual",
      })
    }
  } catch (error) {
    log.error("Error linking bank account:", error)
    res.status(500).json({ error: "Failed to initiate bank account linking" })
  }
}
