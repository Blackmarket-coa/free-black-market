import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { SellerAuthRequest } from "../../../../middlewares/seller-context-v1"
import { OPPORTUNITY_ENGINE_MODULE } from "../../../../../modules/opportunity-engine"
import type OpportunityEngineService from "../../../../../modules/opportunity-engine/service"

const FOCUS_CATEGORIES = ["food", "gardening", "agriculture", "home-goods"]

/**
 * GET /v1/seller/economic-intelligence/trends
 * Economic Intelligence (§15): market trends for the vendor — rising/falling
 * demand (from opportunity scores) and price changes (from the price tracker).
 * Read-only; backed by the materialized opportunity_score + price_observation
 * data the recompute job maintains.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as SellerAuthRequest).seller_id
  if (!sellerId) {
    return res
      .status(401)
      .json({ message: "Unauthorized", type: "unauthorized" })
  }

  const region = String((req.query as Record<string, string>).region || "US")
  const engine = req.scope.resolve<OpportunityEngineService>(
    OPPORTUNITY_ENGINE_MODULE
  )

  const scores = await engine.listTopOpportunities({ region, limit: 100 })
  const byKey = new Map<string, (typeof scores)[number]>()
  for (const s of scores) {
    byKey.set(String(s.subject_key), s)
  }

  const trends = await Promise.all(
    FOCUS_CATEGORIES.map(async (category) => {
      const trend = await engine.getPriceTrend({ category, region })
      const score = byKey.get(category)
      const composite = score ? Number(score.composite) : null
      const demandScore = score ? Number(score.demand_score) : null
      return {
        category,
        opportunity_score: composite,
        demand_direction:
          demandScore === null
            ? "unknown"
            : demandScore >= 0.66
            ? "rising"
            : demandScore <= 0.33
            ? "falling"
            : "steady",
        price_trend: trend,
      }
    })
  )

  // Rising opportunities the vendor could move into now.
  const rising = scores
    .filter((s) => Number(s.composite) >= 7)
    .slice(0, 10)
    .map((s) => ({
      subject_key: s.subject_key,
      opportunity_score: Number(s.composite),
    }))

  return res.status(200).json({
    region,
    trends,
    rising_opportunities: rising,
  })
}
