import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework"
import { createLogger } from "../../../shared/logger"
import { requireSellerId } from "../../../shared"
import { getPromotionState } from "../../../shared/promoted-listing-service"
import { PROMOTION_TIERS } from "../../../shared/promoted-listing"
import { isVendorBillingConfigured } from "../../../shared/vendor-charge-execution"

const log = createLogger("api/vendor/promotion")

/**
 * GET /vendor/promotion
 *
 * The vendor's promoted-listing status and what they could buy.
 *
 * **Still read-only.** The writer is `POST /vendor/promotion/purchase`, which
 * records a charge and grants placement only once it is PAID — so this route
 * never grants anything, and `purchasable` simply reports whether that
 * checkout is live (`isVendorBillingConfigured`). When it is false the panel
 * shows the tiers without a buy button and the operator route
 * (`POST /admin/sellers/:id/promotion`) remains the only writer.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const sellerId = await requireSellerId(req, res)
  if (!sellerId) return

  try {
    const state = await getPromotionState(req.scope, sellerId)

    return res.json({
      promotion: {
        active: state.active,
        expires_at: state.expires_at,
      },
      tiers: PROMOTION_TIERS,
      // The panel renders the tiers either way — knowing what promotion costs
      // is useful before it can be bought — but only shows a buy button when
      // checkout is actually live.
      purchasable: isVendorBillingConfigured(),
      contact_hint: isVendorBillingConfigured()
        ? null
        : "Promoted placement is arranged with the marketplace team while self-serve checkout is being enabled.",
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error"
    log.error("[GET /vendor/promotion] failed", message)
    return res
      .status(500)
      .json({ type: "server_error", message: "Failed to load promotion" })
  }
}
