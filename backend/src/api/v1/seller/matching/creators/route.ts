import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { SellerAuthRequest } from "../../../../middlewares/seller-context-v1"
import { PRODUCER_MODULE } from "../../../../../modules/producer"
import type ProducerService from "../../../../../modules/producer/service"
import { CREATOR_PROGRAM_MODULE } from "../../../../../modules/creator-program"
import type CreatorProgramService from "../../../../../modules/creator-program/service"
import { CREATOR_ATTRIBUTION_MODULE } from "../../../../../modules/creator-attribution"
import type CreatorAttributionService from "../../../../../modules/creator-attribution/service"
import { rankCreators, type CreatorSignal } from "../_ranking"

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
 * GET /v1/seller/matching/creators
 * "Find Creators" — ranks platform creators for the authenticated vendor by
 * niche overlap, region, reach and track record. Read-only; no schema change.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as SellerAuthRequest).seller_id
  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized", type: "unauthorized" })
  }

  const limit = Math.min(Number(req.query.limit) || 20, 100)

  const producerService = req.scope.resolve<ProducerService>(PRODUCER_MODULE)
  const programs =
    req.scope.resolve<CreatorProgramService>(CREATOR_PROGRAM_MODULE)
  const attribution = req.scope.resolve<CreatorAttributionService>(
    CREATOR_ATTRIBUTION_MODULE
  )
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  // Producer signal: region + the categories of the seller's products.
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

  // Candidate creators: everyone who has applied to any program (bounded scan).
  const applications = await programs.listCreatorApplications(
    {},
    { take: 1000 }
  )
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
    const sig = ensure(deal.creator_seller_id)
    sig.attributed_cents += Number(deal.total_attributed_cents) || 0
  }

  for (const link of links as any[]) {
    if (!link?.creator_seller_id) continue
    const sig = ensure(link.creator_seller_id)
    sig.clicks += Number(link.click_count) || 0
  }

  const ranked = rankCreators(
    { categories, region },
    [...byCreator.values()],
    { limit }
  ).map((r) => {
    const sig = byCreator.get(r.creator_seller_id)!
    return {
      creator_seller_id: r.creator_seller_id,
      score: r.score,
      reasons: r.reasons,
      follower_total: sig.follower_total,
      niches: sig.niches,
    }
  })

  return res.status(200).json({
    producer: { categories, region },
    creators: ranked,
  })
}
