import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework"
import { createLogger } from "../../../../shared/logger"
import { requireSellerId } from "../../../../shared"
import {
  PROMOTION_TIERS,
  getPromotionTier,
} from "../../../../shared/promoted-listing"
import { getPromotionState } from "../../../../shared/promoted-listing-service"
import {
  executeCharge,
  isVendorBillingConfigured,
} from "../../../../shared/vendor-charge-execution"
import { VENDOR_BILLING_MODULE } from "../../../../modules/vendor-billing"
import type VendorBillingService from "../../../../modules/vendor-billing/service"
import { VendorChargeKind } from "../../../../modules/vendor-billing/charges"

const log = createLogger("api/vendor/promotion/purchase")

type PurchaseBody = {
  tier_code?: string
  idempotency_key?: string
}

/**
 * POST /vendor/promotion/purchase
 *
 * Buy promoted placement. This is the writer `GET /vendor/promotion` promised
 * once billing existed — and the ordering is the whole design:
 *
 *   1. record the charge (pending)
 *   2. present it to the vendor's saved payment method
 *   3. grant the promotion ONLY when the charge is PAID
 *
 * The grant lives in `fulfillPaidCharge`, reached from the synchronous path
 * when a card settles immediately or from the Stripe webhook when ACH settles
 * days later. At no point does placement exist without a paid (or at least
 * in-flight, ungranted) charge behind it — the free-placement hole the old
 * read-only route was guarding against stays closed.
 *
 * With billing unconfigured this is a 503, not a silent grant: the operator
 * route remains the only free path.
 */
export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const sellerId = await requireSellerId(req, res)
  if (!sellerId) return

  const body = (req.body ?? {}) as PurchaseBody
  const tier = getPromotionTier(body.tier_code)
  if (!tier) {
    return res.status(400).json({
      type: "invalid_data",
      message: `tier_code must be one of: ${PROMOTION_TIERS.map((t) => t.code).join(", ")}`,
    })
  }

  if (!isVendorBillingConfigured()) {
    return res.status(503).json({
      type: "billing_unavailable",
      code: "billing_unavailable",
      message:
        "Self-serve checkout is not enabled yet. Promoted placement is arranged with the marketplace team.",
    })
  }

  try {
    const billing = req.scope.resolve<VendorBillingService>(
      VENDOR_BILLING_MODULE
    )

    // Same-day repeats of the same tier collapse to one charge unless the
    // client sends its own key. Buying "week" twice within a day is far more
    // likely a double-click than intent; a vendor who really wants two weeks
    // buys again tomorrow or sends distinct keys.
    const discriminator =
      body.idempotency_key?.trim() ||
      `${tier.code}:${new Date().toISOString().slice(0, 10)}`

    const { charge, replayed } = await billing.createCharge({
      seller_id: sellerId,
      kind: VendorChargeKind.PROMOTION,
      amount: tier.price_amount,
      currency_code: tier.currency_code,
      description: `Promoted placement — ${tier.display_name}`,
      discriminator,
      metadata: { tier_code: tier.code },
    })

    // A replayed charge is re-presented only if still uncollected; a paid one
    // just reports its state. Either way the vendor is never double-billed.
    const execution = await executeCharge(req.scope, charge.id)
    const promotion = await getPromotionState(req.scope, sellerId)

    return res.status(replayed ? 200 : 201).json({
      charge: {
        id: charge.id,
        status: execution.status,
        amount: charge.amount,
        currency_code: charge.currency_code,
      },
      // `no_payment_method` is the actionable one: the panel should send the
      // vendor to add a card, not show a generic failure.
      execution: {
        executed: execution.executed,
        reason: execution.reason ?? null,
      },
      promotion,
      replayed,
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error"
    log.error("[POST /vendor/promotion/purchase] failed", message)
    return res
      .status(500)
      .json({ type: "server_error", message: "Failed to purchase promotion" })
  }
}
