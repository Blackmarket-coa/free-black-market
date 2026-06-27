import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { createLogger } from "../../../../../shared/logger"
import { EMBED_ANALYTICS_MODULE } from "../../../../../modules/embed-analytics"
import type EmbedAnalyticsService from "../../../../../modules/embed-analytics/service"
import { sellerId, fail } from "../../_helpers"

const log = createLogger("api/vendor/wellness/embed/analytics")

// GET /vendor/wellness/embed/analytics?range=30 — connect.js embed funnel,
// reusing the existing embed-analytics aggregation.
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const seller = await sellerId(req, res)
  if (!seller) return
  try {
    const range = req.query.range ? Number(req.query.range) : 30
    const analytics = req.scope.resolve(EMBED_ANALYTICS_MODULE) as EmbedAnalyticsService
    const data = await analytics.aggregateForSeller(seller, range)
    return res.json({ analytics: data })
  } catch (e) {
    return fail(res, log, "GET embed analytics", e)
  }
}
