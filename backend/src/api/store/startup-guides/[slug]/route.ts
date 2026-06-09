import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { getStartupGuide } from "../../../../modules/opportunity-engine/startup-guides"
import { COOPERATIVE_MODULE } from "../../../../modules/cooperative"

/**
 * GET /store/startup-guides/:slug
 * A single startup guide (§12) with its startup resources and the related
 * products / coalitions / opportunity it links to — the "idea → production"
 * bridge into the Launch Center.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const slug = String(req.params.slug)
  const guide = getStartupGuide(slug)
  if (!guide) {
    return res
      .status(404)
      .json({ message: `Startup guide "${slug}" not found`, type: "not_found" })
  }

  // Related products in the guide's category (best-effort).
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
            c.name.toLowerCase() === guide.category.toLowerCase()
        )
      )
      .slice(0, 12)
      .map((p: any) => ({ id: p.id, title: p.title, handle: p.handle }))
  } catch {
    relatedProducts = []
  }

  let relatedCoalitions: Array<{ id: string; name: string }> = []
  try {
    const coop: any = req.scope.resolve(COOPERATIVE_MODULE)
    const coops = await coop.listCooperatives(
      { public_storefront_enabled: true },
      { take: 8 }
    )
    relatedCoalitions = (coops as any[]).map((c) => ({ id: c.id, name: c.name }))
  } catch {
    relatedCoalitions = []
  }

  return res.status(200).json({
    guide: {
      slug: guide.slug,
      title: guide.title,
      category: guide.category,
      summary: guide.summary,
      estimated_startup_cost_cents: guide.estimated_startup_cost_cents,
      difficulty: guide.difficulty,
      required_equipment: guide.required_equipment,
      production_suggestions: guide.production_suggestions,
      related_archetypes: guide.related_archetypes,
      related_opportunity_key: guide.related_opportunity_key,
    },
    related_products: relatedProducts,
    related_coalitions: relatedCoalitions,
    // The "Launch this business" CTA posts to /v1/seller/launches with
    // launch_type=BUSINESS, prefilled from this guide.
    launch_hint: {
      launch_type: "BUSINESS",
      category: guide.category,
      title: guide.title,
    },
  })
}
