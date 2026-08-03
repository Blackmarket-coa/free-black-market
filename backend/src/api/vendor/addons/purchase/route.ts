import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework"
import { createLogger } from "../../../../shared/logger"
import { requireSellerId } from "../../../../shared"
import {
  getAddonDefinition,
  listPurchasableAddons,
} from "../../../../modules/vendor-plan/addons"
import { getAddonOwnership } from "../../../../shared/vendor-addons"
import {
  executeCharge,
  isVendorBillingConfigured,
} from "../../../../shared/vendor-charge-execution"
import { VENDOR_BILLING_MODULE } from "../../../../modules/vendor-billing"
import type VendorBillingService from "../../../../modules/vendor-billing/service"
import { VendorChargeKind } from "../../../../modules/vendor-billing/charges"

const log = createLogger("api/vendor/addons/purchase")

type PurchaseBody = {
  code?: string
  idempotency_key?: string
}

/**
 * POST /vendor/addons/purchase
 *
 * Buy an add-on pack. Identical sequencing to the promotion purchase, because
 * the invariant is the same:
 *
 *   1. record the charge (pending)
 *   2. present it to the vendor's saved payment method
 *   3. grant the pack ONLY when the charge is PAID
 *
 * The grant lives in `fulfillPaidCharge` — reached synchronously when a card
 * settles at once, or from the Stripe webhook when a slow rail settles later —
 * so at no point do features exist without a paid charge behind them. The
 * admin route stays the only free path.
 */
export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const sellerId = await requireSellerId(req, res)
  if (!sellerId) return

  const body = (req.body ?? {}) as PurchaseBody
  const addon = getAddonDefinition(body.code)
  if (!addon || !addon.is_active) {
    return res.status(400).json({
      type: "invalid_data",
      message: `code must be one of: ${listPurchasableAddons()
        .map((a) => a.code)
        .join(", ")}`,
    })
  }

  if (!isVendorBillingConfigured()) {
    return res.status(503).json({
      type: "billing_unavailable",
      code: "billing_unavailable",
      message:
        "Self-serve checkout is not enabled yet. Add-ons are arranged with the marketplace team.",
    })
  }

  try {
    const billing = req.scope.resolve<VendorBillingService>(
      VENDOR_BILLING_MODULE
    )

    // Same-day repeats of the same pack collapse to one charge unless the
    // client sends its own key — a same-day repeat is far more likely a
    // double-click than an intentional second month.
    const discriminator =
      body.idempotency_key?.trim() ||
      `${addon.code}:${new Date().toISOString().slice(0, 10)}`

    const { charge, replayed } = await billing.createCharge({
      seller_id: sellerId,
      kind: VendorChargeKind.ADDON,
      amount: addon.price_amount,
      currency_code: addon.currency_code,
      description: `Add-on — ${addon.display_name} (${addon.duration_days} days)`,
      discriminator,
      metadata: { addon_code: addon.code },
    })

    const execution = await executeCharge(req.scope, charge.id)
    const owned = (await getAddonOwnership(req.scope, sellerId)).find(
      (o) => o.code === addon.code
    )

    return res.status(replayed ? 200 : 201).json({
      charge: {
        id: charge.id,
        status: execution.status,
        amount: charge.amount,
        currency_code: charge.currency_code,
      },
      execution: {
        executed: execution.executed,
        reason: execution.reason ?? null,
      },
      addon: owned ?? { code: addon.code, active: false, expires_at: null },
      replayed,
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error"
    log.error("[POST /vendor/addons/purchase] failed", message)
    return res
      .status(500)
      .json({ type: "server_error", message: "Failed to purchase add-on" })
  }
}
