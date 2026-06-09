import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { OPPORTUNITY_ENGINE_MODULE } from "../../../../modules/opportunity-engine"
import type OpportunityEngineService from "../../../../modules/opportunity-engine/service"
import { gatherCategorySignals } from "../../../../modules/opportunity-engine/_signals"
import { listStartupGuides } from "../../../../modules/opportunity-engine/startup-guides"
import { COOPERATIVE_MODULE } from "../../../../modules/cooperative"

/**
 * GET /store/opportunities/:subject
 * Opportunity page (§5) for a category subject: live market demand,
 * price trend (§15), startup requirements (§12 guide), and related products /
 * coalitions. `:subject` is the category key (e.g. "compost", "agriculture").
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const subject = String(req.params.subject)
  const region = String((req.query as Record<string, string>).region || "US")

  const engine = req.scope.resolve<OpportunityEngineService>(
    OPPORTUNITY_ENGINE_MODULE
  )

  // Live signal snapshot (also reflects what the recompute job stores).
  const snapshot = await gatherCategorySignals(req.scope, {
    category: subject,
    region,
  })
  const trend = await engine.getPriceTrend({ category: subject, region })

  // Startup requirements: the guides whose opportunity key matches.
  const guides = listStartupGuides().filter(
    (g) =>
      g.related_opportunity_key.toLowerCase() === subject.toLowerCase() ||
      g.category.toLowerCase() === subject.toLowerCase()
  )

  // Related products in the category (best-effort).
  let relatedProducts: Array<{ id: string; title: string; handle: string }> = []
  try {
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
      entity: "product",
      fields: ["id", "title", "handle", "categories.name"],
      filters: { status: "published" },
      pagination: { take: 200 },
    })
    relatedProducts = (data || [])
      .filter((p: any) =>
        (p?.categories ?? []).some(
          (c: any) =>
            typeof c?.name === "string" &&
            c.name.toLowerCase() === subject.toLowerCase()
        )
      )
      .slice(0, 12)
      .map((p: any) => ({ id: p.id, title: p.title, handle: p.handle }))
  } catch {
    relatedProducts = []
  }

  // Related coalitions (cooperatives) — best-effort by region.
  let relatedCoalitions: Array<{ id: string; name: string }> = []
  try {
    const coop: any = req.scope.resolve(COOPERATIVE_MODULE)
    const coops = await coop.listCooperatives(
      { public_storefront_enabled: true },
      { take: 50 }
    )
    relatedCoalitions = (coops as any[])
      .slice(0, 8)
      .map((c) => ({ id: c.id, name: c.name }))
  } catch {
    relatedCoalitions = []
  }

  return res.status(200).json({
    subject_key: subject,
    region,
    opportunity_score: snapshot.score.composite,
    bands: snapshot.score.bands,
    market_demand: snapshot.demand_raw,
    competition: snapshot.competition_raw,
    startup_cost_dollars: snapshot.startup_cost_dollars,
    price_trend: trend,
    startup_requirements: guides.map((g) => ({
      slug: g.slug,
      title: g.title,
      estimated_startup_cost_cents: g.estimated_startup_cost_cents,
      required_equipment: g.required_equipment,
      production_suggestions: g.production_suggestions,
    })),
    related_products: relatedProducts,
    related_coalitions: relatedCoalitions,
  })
}
