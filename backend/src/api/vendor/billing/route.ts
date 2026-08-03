import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework"
import { createLogger } from "../../../shared/logger"
import { requireSellerId } from "../../../shared"
import { VENDOR_BILLING_MODULE } from "../../../modules/vendor-billing"
import type VendorBillingService from "../../../modules/vendor-billing/service"
import { VENDOR_PLAN_MODULE } from "../../../modules/vendor-plan"
import type VendorPlanService from "../../../modules/vendor-plan/service"
import { isVendorBillingConfigured } from "../../../shared/vendor-charge-execution"

const log = createLogger("api/vendor/billing")

/**
 * GET /vendor/billing
 *
 * The vendor's side of the charge ledger: what they owe, what they have been
 * charged for, and whether self-serve payment is possible yet.
 *
 * Deliberately NOT plan-gated (like `/vendor/plan/*`): a vendor must always be
 * able to see and settle their balance — especially a vendor whose access was
 * reduced *because* of an unpaid balance.
 *
 * `has_payment_method` here means "has a Stripe customer", not "has a working
 * card" — verifying the card means a Stripe round trip on every billing-page
 * load, and the truth comes out the moment a charge is presented anyway. The
 * panel treats it as "setup has been completed at least once".
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const sellerId = await requireSellerId(req, res)
  if (!sellerId) return

  try {
    const billing = req.scope.resolve<VendorBillingService>(
      VENDOR_BILLING_MODULE
    )
    const plans = req.scope.resolve<VendorPlanService>(VENDOR_PLAN_MODULE)

    const [charges, balance, assignment] = await Promise.all([
      billing.listForSeller(sellerId),
      billing.getOutstandingBalance(sellerId),
      plans.ensureAssignment(sellerId) as Promise<{
        stripe_customer_id?: string | null
      }>,
    ])

    return res.json({
      outstanding: balance,
      charges: charges.slice(0, 50).map((c) => ({
        id: c.id,
        kind: c.kind,
        status: c.status,
        amount: c.amount,
        currency_code: c.currency_code,
        description: c.description,
        period_start: c.period_start ?? null,
        period_end: c.period_end ?? null,
        failure_reason: c.failure_reason ?? null,
        paid_at: c.paid_at ?? null,
      })),
      billing_enabled: isVendorBillingConfigured(),
      has_payment_method: !!assignment.stripe_customer_id,
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error"
    log.error("[GET /vendor/billing] failed", message)
    return res
      .status(500)
      .json({ type: "server_error", message: "Failed to load billing" })
  }
}
