import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework"
import { createLogger } from "../../../../shared/logger"
import { requireSellerId } from "../../../../shared"
import { createBillingSetupIntent } from "../../../../shared/vendor-charge-execution"

const log = createLogger("api/vendor/billing/setup-intent")

/**
 * POST /vendor/billing/setup-intent
 *
 * Begin saving a payment method. Returns a SetupIntent `client_secret` for
 * the panel to confirm with Stripe.js — card details never touch this
 * backend, which is what keeps it out of PCI scope.
 *
 * This is the missing half of self-serve purchase: until a vendor completes
 * this once, every purchase and renewal parks at `no_payment_method` and sits
 * in their balance as pending.
 */
export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const sellerId = await requireSellerId(req, res)
  if (!sellerId) return

  try {
    const result = await createBillingSetupIntent(req.scope, sellerId)

    if (!result.available) {
      return res.status(503).json({
        type: "billing_unavailable",
        code: "billing_unavailable",
        message: "Payment method setup is not enabled on this deployment.",
      })
    }

    return res.json({
      client_secret: result.client_secret,
      stripe_customer_id: result.stripe_customer_id,
      publishable_key: result.publishable_key,
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error"
    log.error("[POST /vendor/billing/setup-intent] failed", message)
    return res.status(500).json({
      type: "server_error",
      message: "Failed to start payment method setup",
    })
  }
}
