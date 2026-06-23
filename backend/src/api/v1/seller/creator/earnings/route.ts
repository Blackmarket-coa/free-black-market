import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { SellerAuthRequest } from "../../../../middlewares/seller-context-v1"
import { CREATOR_ATTRIBUTION_MODULE } from "../../../../../modules/creator-attribution"
import CreatorAttributionService from "../../../../../modules/creator-attribution/service"

/**
 * GET /v1/seller/creator/earnings
 *   ?from=ISO8601&to=ISO8601&limit=N&offset=N
 *
 * Returns rollup totals plus the most recent attribution rows for drill-down.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as SellerAuthRequest).seller_id
  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized", type: "unauthorized" })
  }

  const fromParam = req.query.from as string | undefined
  const toParam = req.query.to as string | undefined
  const from = fromParam ? new Date(fromParam) : undefined
  const to = toParam ? new Date(toParam) : undefined
  if ((from && isNaN(from.getTime())) || (to && isNaN(to.getTime()))) {
    return res.status(400).json({ message: "Invalid date range", type: "invalid_request" })
  }

  const limit = Math.min(Math.max(parseInt((req.query.limit as string) || "50", 10) || 50, 1), 200)
  const offset = Math.max(parseInt((req.query.offset as string) || "0", 10) || 0, 0)

  const service = req.scope.resolve<CreatorAttributionService>(
    CREATOR_ATTRIBUTION_MODULE
  )

  const [rollup, attributions] = await Promise.all([
    service.creatorEarningsRollup(sellerId, { from, to }),
    service.listOrderAttributions(
      { creator_seller_id: sellerId },
      { take: limit, skip: offset, order: { attribution_decided_at: "DESC" } as const }
    ),
  ])

  return res.status(200).json({
    rollup,
    attributions,
    limit,
    offset,
  })
}
