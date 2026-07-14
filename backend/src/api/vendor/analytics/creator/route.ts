import { createLogger } from "../../../../shared/logger"
const log = createLogger("api/vendor/analytics/creator")
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { VendorRequest } from "../../types"
import {
  creatorAttributionQuery,
  creatorByCampaignQuery,
  creatorByDayQuery,
  creatorTotalsQuery,
  mapCreatorTotals,
  rangeToWindow,
} from "../../../../modules/creator-attribution/analytics-queries"

/**
 * GET /vendor/analytics/creator?range=30
 *
 * Creator performance for the authenticated seller (Phase 4A): profile
 * views / link clicks / affiliate clicks from analytics_event (scoped by
 * the indexed creator_seller_id), attributed orders + commission from
 * order_attribution, plus by-day and by-campaign breakdowns.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const sellerId =
    (req as VendorRequest)._seller_id || (req as VendorRequest).auth_context?.actor_id
  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized", type: "unauthorized" })
  }

  const window = rangeToWindow((req.query as Record<string, unknown>).range)

  try {
    const pg = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
    const [totals, attribution, byDay, byCampaign] = await Promise.all([
      pg.raw(...toRawArgs(creatorTotalsQuery({ creatorSellerId: sellerId, window }))),
      pg.raw(...toRawArgs(creatorAttributionQuery({ creatorSellerId: sellerId, window }))),
      pg.raw(...toRawArgs(creatorByDayQuery({ creatorSellerId: sellerId, window }))),
      pg.raw(...toRawArgs(creatorByCampaignQuery({ creatorSellerId: sellerId, window }))),
    ])

    return res.status(200).json({
      range_days: window.days,
      totals: mapCreatorTotals(totals.rows ?? [], attribution.rows ?? []),
      by_day: (byDay.rows ?? []).map((r: Record<string, unknown>) => ({
        date: String(r.date),
        profile_views: Number(r.profile_views) || 0,
        link_clicks: Number(r.link_clicks) || 0,
      })),
      by_campaign: (byCampaign.rows ?? []).map((r: Record<string, unknown>) => ({
        campaign: String(r.campaign),
        events: Number(r.events) || 0,
        link_clicks: Number(r.link_clicks) || 0,
      })),
    })
  } catch (err) {
    log.error("[analytics/creator] failed", err)
    return res
      .status(500)
      .json({ message: "Failed to load creator analytics", type: "server_error" })
  }
}

function toRawArgs(q: {
  sql: string
  bindings: Array<string | number | Date>
}): [string, Array<string | number | Date>] {
  return [q.sql, q.bindings]
}
