import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { OPPORTUNITY_ENGINE_MODULE } from "../../../modules/opportunity-engine"
import type OpportunityEngineService from "../../../modules/opportunity-engine/service"

/**
 * GET /store/opportunities
 * Ranked local-production opportunities (§5). Reads the materialized
 * `opportunity_score` table (recomputed by the recompute-opportunity-scores
 * job). Filter by region; sorted by composite score descending.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const engine = req.scope.resolve<OpportunityEngineService>(
    OPPORTUNITY_ENGINE_MODULE
  )

  const { region = "US", limit = "20", offset = "0" } = req.query as Record<
    string,
    string
  >

  const rows = await engine.listTopOpportunities({
    region,
    limit: Math.min(parseInt(limit, 10) || 20, 100),
    offset: parseInt(offset, 10) || 0,
  })

  const opportunities = (rows as any[]).map((r) => ({
    id: r.id,
    subject_key: r.subject_key,
    subject_label: r.subject_label,
    region: r.region,
    opportunity_score: Number(r.composite),
    demand: Number(r.demand_score),
    competition: Number(r.competition_score),
    startup_cost: Number(r.startup_cost_score),
    bands: (r.signals as any)?.score?.bands ?? null,
    computed_at: r.computed_at,
  }))

  return res.status(200).json({ region, count: opportunities.length, opportunities })
}
