import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework"
import { createLogger } from "../../../../shared/logger"
import { requireSellerId } from "../../../../shared"
import { getSellerPlanLimits } from "../../../../shared/seller-plan"
import { clampToLimit } from "../../../../modules/vendor-plan/limits"
import { EMBED_ANALYTICS_MODULE } from "../../../../modules/embed-analytics"
import type EmbedAnalyticsService from "../../../../modules/embed-analytics/service"

const log = createLogger("api/vendor/analytics/embed")

/**
 * GET /vendor/analytics/embed?range=30
 *
 * Aggregated connect.js embed analytics for the authenticated vendor:
 * funnel, traffic by domain, daily views/orders, and top products.
 *
 * `range` is clamped to the vendor's plan rather than refused. The window IS
 * the meter here, and answering a dashboard read with a 402 would leave the
 * vendor staring at an error where a shorter chart would have told them
 * something true. The response reports the range actually used
 * (`analytics.range_days`) plus the ceiling, so the panel can offer the upsell
 * in place.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const sellerId = await requireSellerId(req, res)
  if (!sellerId) return

  const requested = Math.min(Math.max(Number(req.query.range) || 30, 1), 365)

  try {
    const { plan_code, limits } = await getSellerPlanLimits(req.scope, sellerId)
    const range = clampToLimit(requested, limits.analytics_range_days)

    const analytics = req.scope.resolve(
      EMBED_ANALYTICS_MODULE
    ) as EmbedAnalyticsService
    const data = await analytics.aggregateForSeller(sellerId, range)
    return res.json({
      analytics: data,
      range: {
        requested_days: requested,
        applied_days: range,
        max_days: limits.analytics_range_days,
        truncated: range < requested,
        current_plan: plan_code,
      },
    })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error"
    log.error("[GET /vendor/analytics/embed] failed:", msg)
    return res
      .status(500)
      .json({ message: "Failed to load embed analytics", type: "server_error" })
  }
}
