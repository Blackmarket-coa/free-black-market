import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { OPPORTUNITY_ENGINE_MODULE } from "../../../modules/opportunity-engine"
import type OpportunityEngineService from "../../../modules/opportunity-engine/service"

const FOCUS_CATEGORIES = ["food", "gardening", "agriculture", "home-goods"]

/**
 * GET /store/price-tracker
 * Price Tracker (§5): price series + trend for a category in a region (US /
 * state / named region). Focus categories: Food, Gardening, Agriculture,
 * Household. Pass ?category=&region= for one, or omit category for the focus set.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const engine = req.scope.resolve<OpportunityEngineService>(
    OPPORTUNITY_ENGINE_MODULE
  )
  const { category, region = "US" } = req.query as Record<string, string>

  const categories = category ? [category] : FOCUS_CATEGORIES

  const tracks = await Promise.all(
    categories.map(async (cat) => {
      const series = await engine.getPriceSeries({
        category: cat,
        region,
        limit: 365,
      })
      const trend = await engine.getPriceTrend({ category: cat, region })
      return {
        category: cat,
        region,
        trend,
        series: (series as any[]).map((s) => ({
          price_cents: Number(s.price_cents),
          unit: s.unit,
          observed_at: s.observed_at,
        })),
      }
    })
  )

  return res.status(200).json({ region, tracks })
}
