import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { createLogger } from "../../../../../shared/logger"
import {
  getPromotionState,
  grantPromotion,
  revokePromotion,
} from "../../../../../shared/promoted-listing-service"
import {
  PROMOTION_TIERS,
  getPromotionTier,
} from "../../../../../shared/promoted-listing"

const log = createLogger("api/admin/sellers/promotion")

type GrantBody = {
  /** A tier from `PROMOTION_TIERS`. Omit for an open-ended operator promotion. */
  tier_code?: string | null
  reason?: string | null
}

/**
 * GET /admin/sellers/:id/promotion — is this seller promoted, and until when?
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const sellerId = String(req.params.id || "").trim()
  if (!sellerId) {
    return res
      .status(400)
      .json({ type: "invalid_data", message: "seller id is required" })
  }

  try {
    const state = await getPromotionState(req.scope, sellerId)
    return res.json({ promotion: state, tiers: PROMOTION_TIERS })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error"
    log.error("[GET /admin/sellers/:id/promotion] failed", message)
    return res
      .status(500)
      .json({ type: "server_error", message: "Failed to load promotion" })
  }
}

/**
 * POST /admin/sellers/:id/promotion — grant or extend promoted placement.
 *
 * Operator-only, and deliberately so: granting a promotion is granting free
 * placement until a charge exists to put in front of it. The vendor-facing
 * route is read-only for the same reason — see `api/vendor/promotion/route.ts`.
 */
export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const sellerId = String(req.params.id || "").trim()
  if (!sellerId) {
    return res
      .status(400)
      .json({ type: "invalid_data", message: "seller id is required" })
  }

  const body = (req.body ?? {}) as GrantBody
  const tierCode =
    typeof body.tier_code === "string" && body.tier_code.trim()
      ? body.tier_code.trim()
      : null

  if (tierCode && !getPromotionTier(tierCode)) {
    return res.status(400).json({
      type: "invalid_data",
      message: `Unknown promotion tier: ${tierCode}`,
      valid_tiers: PROMOTION_TIERS.map((t) => t.code),
    })
  }

  try {
    const state = await grantPromotion(req.scope, {
      sellerId,
      tierCode,
      reason: body.reason ?? null,
    })
    return res.json({ promotion: state })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error"
    log.error("[POST /admin/sellers/:id/promotion] failed", message)
    return res
      .status(500)
      .json({ type: "server_error", message: "Failed to grant promotion" })
  }
}

/**
 * DELETE /admin/sellers/:id/promotion — end promoted placement now.
 *
 * Distinct from letting it lapse: this revokes the entitlement outright, which
 * is what a refund or a policy removal needs.
 */
export async function DELETE(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const sellerId = String(req.params.id || "").trim()
  if (!sellerId) {
    return res
      .status(400)
      .json({ type: "invalid_data", message: "seller id is required" })
  }

  const reason =
    typeof (req.body as { reason?: string })?.reason === "string"
      ? (req.body as { reason?: string }).reason
      : undefined

  try {
    const revoked = await revokePromotion(req.scope, sellerId, reason)
    const state = await getPromotionState(req.scope, sellerId)
    return res.json({ revoked, promotion: state })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error"
    log.error("[DELETE /admin/sellers/:id/promotion] failed", message)
    return res
      .status(500)
      .json({ type: "server_error", message: "Failed to revoke promotion" })
  }
}
