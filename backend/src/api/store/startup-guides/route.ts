import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { listStartupGuides } from "../../../modules/opportunity-engine/startup-guides"

/**
 * GET /store/startup-guides
 * Business Launch System catalog (§12). Code-sourced; lists the startup guides
 * (seedling, compost, soap, gardening …) with cost/difficulty for the
 * "Start a Business" directory.
 */
export async function GET(_req: MedusaRequest, res: MedusaResponse) {
  const guides = listStartupGuides().map((g) => ({
    slug: g.slug,
    title: g.title,
    category: g.category,
    summary: g.summary,
    estimated_startup_cost_cents: g.estimated_startup_cost_cents,
    difficulty: g.difficulty,
    related_opportunity_key: g.related_opportunity_key,
  }))
  return res.status(200).json({ count: guides.length, guides })
}
