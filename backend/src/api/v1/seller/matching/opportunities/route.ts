import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { SellerAuthRequest } from "../../../../middlewares/seller-context-v1"
import { CREATOR_PROGRAM_MODULE } from "../../../../../modules/creator-program"
import type CreatorProgramService from "../../../../../modules/creator-program/service"
import { DEMAND_POOL_MODULE } from "../../../../../modules/demand-pool"
import type DemandPoolModuleService from "../../../../../modules/demand-pool/service"
import { jaccard } from "../_ranking"

/**
 * GET /v1/seller/matching/opportunities
 * Inverse of "Find Creators": suggested marketing bounties + open programs for
 * the authenticated creator-seller, ranked by niche overlap with the creator's
 * declared platforms. Read-only.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const creatorSellerId = (req as SellerAuthRequest).seller_id
  if (!creatorSellerId) {
    return res.status(401).json({ message: "Unauthorized", type: "unauthorized" })
  }

  const limit = Math.min(Number(req.query.limit) || 20, 100)

  const programs =
    req.scope.resolve<CreatorProgramService>(CREATOR_PROGRAM_MODULE)
  const demand = req.scope.resolve<DemandPoolModuleService>(DEMAND_POOL_MODULE)

  // Creator's declared niches from their own applications.
  const myApps = await programs.listCreatorApplications({
    creator_seller_id: creatorSellerId,
  })
  const niches = [
    ...new Set(
      (myApps as any[])
        .flatMap((a) =>
          Array.isArray(a?.proposed_platforms) ? a.proposed_platforms : []
        )
        .filter((p: unknown): p is string => typeof p === "string")
    ),
  ]
  const appliedProgramIds = new Set(
    (myApps as any[]).map((a) => a.program_id).filter(Boolean)
  )

  // Open marketing bounties (demand-posts), ranked by category vs niche overlap.
  const openPosts = await demand.getOpenDemandPools({
    sort_by: "attractiveness",
    limit: 100,
  })
  const bounties = await Promise.all(
    (openPosts as any[]).map(async (post) => {
      const postBounties = await demand.listDemandBounties({
        demand_post_id: post.id,
      })
      const open = postBounties.filter((b: any) => !b.assignee_id)
      const overlap = post.category ? jaccard(niches, [post.category]) : 0
      const score =
        Math.round(
          (overlap * 0.6 + Math.min(1, Number(post.attractiveness_score) / 100) * 0.4) *
            1000
        ) / 1000
      return {
        demand_post_id: post.id,
        title: post.title,
        category: post.category,
        cooperative_id: post.cooperative_id ?? null,
        product_id: post.product_id ?? null,
        open_bounties: open.map((b: any) => ({
          bounty_id: b.id,
          objective: b.objective,
          amount: Number(b.amount),
          currency_code: b.currency_code,
        })),
        score,
      }
    })
  )

  const rankedBounties = bounties
    .filter((b) => b.open_bounties.length > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)

  // Open programs the creator hasn't applied to yet.
  const openPrograms = (await programs.listOpenPrograms())
    .filter((p: any) => !appliedProgramIds.has(p.id))
    .slice(0, limit)
    .map((p: any) => ({
      program_id: p.id,
      title: p.title,
      slug: p.slug,
      vendor_id: p.vendor_id,
      program_type: p.program_type,
      commission_percent: p.commission_percent,
    }))

  return res.status(200).json({
    creator: { creator_seller_id: creatorSellerId, niches },
    bounties: rankedBounties,
    programs: openPrograms,
  })
}
