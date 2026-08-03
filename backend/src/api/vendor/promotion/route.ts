import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework"
import { createLogger } from "../../../shared/logger"
import { requireSellerId } from "../../../shared"
import { getPromotionState } from "../../../shared/promoted-listing-service"
import { PROMOTION_TIERS } from "../../../shared/promoted-listing"

const log = createLogger("api/vendor/promotion")

/**
 * GET /vendor/promotion
 *
 * The vendor's promoted-listing status and what they could buy.
 *
 * **Read-only on purpose.** A promotion is placement at the top of the public
 * directory, and there is no charge wired yet — `hawala-ledger/stripe-ach.ts`
 * has the machinery but nothing bills a vendor for anything today. A
 * self-serve `POST` here would hand out free permanent placement to anyone who
 * found the endpoint. Purchase lands with the billing work; until then the
 * operator route (`POST /admin/sellers/:id/promotion`) is the only writer, and
 * `purchasable: false` tells the panel to show the tiers without a buy button.
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
      // Flips to true when checkout exists. The panel should render the tiers
      // either way — knowing what promotion costs is useful before it can be
      // bought — but must not offer a button that would grant it for nothing.
      purchasable: false,
      contact_hint:
        "Promoted placement is arranged with the marketplace team while self-serve checkout is being built.",
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error"
    log.error("[GET /vendor/promotion] failed", message)
    return res
      .status(500)
      .json({ type: "server_error", message: "Failed to load promotion" })
  }
}
