import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { SellerAuthRequest } from "../../../../middlewares/seller-context-v1"
import { PRODUCER_MODULE } from "../../../../../modules/producer"
import type ProducerService from "../../../../../modules/producer/service"
import { CREATOR_PROGRAM_MODULE } from "../../../../../modules/creator-program"
import type CreatorProgramService from "../../../../../modules/creator-program/service"
import { CREATOR_ATTRIBUTION_MODULE } from "../../../../../modules/creator-attribution"
import type CreatorAttributionService from "../../../../../modules/creator-attribution/service"
import { COOPERATIVE_MODULE } from "../../../../../modules/cooperative"
import { OPPORTUNITY_ENGINE_MODULE } from "../../../../../modules/opportunity-engine"
import type OpportunityEngineService from "../../../../../modules/opportunity-engine/service"
import { rankCreators, type CreatorSignal } from "../../matching/_ranking"

function sumSnapshot(snapshot: unknown): number {
  if (!snapshot || typeof snapshot !== "object") {
    return 0
  }
  return Object.values(snapshot as Record<string, unknown>).reduce<number>(
    (sum, v) => sum + (typeof v === "number" && Number.isFinite(v) ? v : 0),
    0
  )
}

/**
 * GET /v1/seller/growth/suggestions
 * Vendor Growth Dashboard suggestions (§11): recommended creators (matching
 * ranking), recommended coalitions, and high-demand products to launch
 * (opportunity scores). Read-only; reuses existing modules.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as SellerAuthRequest).seller_id
  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized", type: "unauthorized" })
  }

  const producerService = req.scope.resolve<ProducerService>(PRODUCER_MODULE)
  const programs =
    req.scope.resolve<CreatorProgramService>(CREATOR_PROGRAM_MODULE)
  const attribution = req.scope.resolve<CreatorAttributionService>(
    CREATOR_ATTRIBUTION_MODULE
  )
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  // Seller signal: region + product categories.
  const producerRows = await producerService.listProducers({
    seller_id: sellerId,
  })
  const region = (producerRows[0]?.region ?? null) as string | null

  let categories: string[] = []
  try {
    const { data: sellerProducts } = await query.graph({
      entity: "seller_product",
      fields: ["product.categories.name"],
      filters: { seller_id: sellerId },
    })
    categories = [
      ...new Set(
        (sellerProducts || [])
          .flatMap((sp: any) => sp?.product?.categories ?? [])
          .map((c: any) => c?.name)
          .filter((n: unknown): n is string => typeof n === "string")
      ),
    ]
  } catch {
    categories = []
  }

  // ── Recommended creators (reuse the matching ranking) ──
  let recommendedCreators: Array<{
    creator_seller_id: string
    score: number
    reasons: string[]
  }> = []
  try {
    const applications = await programs.listCreatorApplications({}, { take: 1000 })
    const deals = await programs.listCreatorDeals({}, { take: 2000 })
    const links = await attribution.listAffiliateLinks({}, { take: 5000 })

    const byCreator = new Map<string, CreatorSignal>()
    const ensure = (id: string): CreatorSignal => {
      let sig = byCreator.get(id)
      if (!sig) {
        sig = {
          creator_seller_id: id,
          niches: [],
          regions: [],
          follower_total: 0,
          attributed_cents: 0,
          clicks: 0,
        }
        byCreator.set(id, sig)
      }
      return sig
    }
    for (const app of applications as any[]) {
      if (!app?.creator_seller_id) continue
      const sig = ensure(app.creator_seller_id)
      const platforms = Array.isArray(app.proposed_platforms)
        ? (app.proposed_platforms as string[])
        : []
      sig.niches = [...new Set([...sig.niches, ...platforms])]
      sig.follower_total = Math.max(
        sig.follower_total,
        sumSnapshot(app.follower_snapshot)
      )
    }
    for (const deal of deals as any[]) {
      if (!deal?.creator_seller_id) continue
      ensure(deal.creator_seller_id).attributed_cents +=
        Number(deal.total_attributed_cents) || 0
    }
    for (const link of links as any[]) {
      if (!link?.creator_seller_id) continue
      ensure(link.creator_seller_id).clicks += Number(link.click_count) || 0
    }
    recommendedCreators = rankCreators(
      { categories, region },
      [...byCreator.values()],
      { limit: 5 }
    )
  } catch {
    recommendedCreators = []
  }

  // ── Recommended coalitions (public, best-effort) ──
  let recommendedCoalitions: Array<{ id: string; name: string }> = []
  try {
    const coop: any = req.scope.resolve(COOPERATIVE_MODULE)
    const filters: Record<string, unknown> = {
      public_storefront_enabled: true,
    }
    if (region) {
      filters.region = region
    }
    const coops = await coop.listCooperatives(filters, { take: 5 })
    recommendedCoalitions = (coops as any[]).map((c) => ({
      id: c.id,
      name: c.name,
    }))
  } catch {
    recommendedCoalitions = []
  }

  // ── High-demand products to launch (opportunity scores) ──
  let highDemand: Array<{ subject_key: string; opportunity_score: number }> = []
  try {
    const engine = req.scope.resolve<OpportunityEngineService>(
      OPPORTUNITY_ENGINE_MODULE
    )
    const scores = await engine.listTopOpportunities({ limit: 100 })
    const preferred = (scores as any[]).filter(
      (s) =>
        categories.length === 0 ||
        categories.some(
          (c) => c.toLowerCase() === String(s.subject_key).toLowerCase()
        )
    )
    const pool = preferred.length > 0 ? preferred : (scores as any[])
    highDemand = pool.slice(0, 5).map((s) => ({
      subject_key: s.subject_key,
      opportunity_score: Number(s.composite),
    }))
  } catch {
    highDemand = []
  }

  return res.status(200).json({
    seller_id: sellerId,
    recommended_creators: recommendedCreators,
    recommended_coalitions: recommendedCoalitions,
    high_demand_products: highDemand,
  })
}
