import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework"
import { createLogger } from "../../../../shared/logger"
import { requireSellerId } from "../../../../shared"
import { EMBED_ANALYTICS_MODULE } from "../../../../modules/embed-analytics"
import type EmbedAnalyticsService from "../../../../modules/embed-analytics/service"

const log = createLogger("api/vendor/analytics/embed")

/**
 * GET /vendor/analytics/embed?range=30
 *
 * Aggregated connect.js embed analytics for the authenticated vendor:
 * funnel, traffic by domain, daily views/orders, and top products.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const sellerId = await requireSellerId(req, res)
  if (!sellerId) return

  const range = Math.min(Math.max(Number(req.query.range) || 30, 1), 365)

  try {
    const analytics = req.scope.resolve(
      EMBED_ANALYTICS_MODULE
    ) as EmbedAnalyticsService
    const data = await analytics.aggregateForSeller(sellerId, range)
    return res.json({ analytics: data })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error"
    log.error("[GET /vendor/analytics/embed] failed:", msg)
    return res
      .status(500)
      .json({ message: "Failed to load embed analytics", type: "server_error" })
  }
}
