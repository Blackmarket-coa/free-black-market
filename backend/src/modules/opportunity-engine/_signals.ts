/**
 * Cross-module signal gathering for the Opportunity Engine.
 *
 * Impure (reads other modules through the Medusa scope) — kept separate from
 * the pure `_scoring.ts` so the math stays unit-testable. Used by both the
 * `recompute-opportunity-scores` job and the `/store/opportunities/[id]` route.
 *
 * Every cross-module read is defensive (try/catch → 0), mirroring
 * `api/v1/seller/matching/creators/route.ts`: a missing link or shape
 * difference degrades a signal to zero rather than failing the request.
 */

import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { DEMAND_POOL_MODULE } from "../demand-pool"
import type DemandPoolModuleService from "../demand-pool/service"
import {
  normalizeDemand,
  normalizeCompetition,
  normalizeStartupCost,
  computeOpportunityScore,
  type OpportunityScore as ComputedScore,
} from "./_scoring"
import { startupCostDollarsForSubject } from "./startup-guides"

type Scope = {
  resolve: <T = any>(key: string) => T
}

export type CategorySignalSnapshot = {
  demand_raw: {
    openDemandPosts: number
    committedQuantity: number
    targetQuantity: number
    bountyDollars: number
    wishlistCount: number
    coalitionNeeds: number
  }
  competition_raw: { activeSellers: number; activeListings: number }
  startup_cost_dollars: number | null
  normalized: { demand: number; competition: number; startupCost: number }
  score: ComputedScore
}

const OPEN_STATUSES = ["OPEN", "THRESHOLD_MET"]

/** Gather + score signals for a category subject in a region. */
export async function gatherCategorySignals(
  scope: Scope,
  opts: { category: string; region?: string }
): Promise<CategorySignalSnapshot> {
  const region = opts.region || "US"
  const category = opts.category

  // ── Demand (robust: demand-pool is in-module-family and always present) ──
  let openDemandPosts = 0
  let committedQuantity = 0
  let targetQuantity = 0
  let bountyDollars = 0
  let coalitionNeeds = 0
  try {
    const demand = scope.resolve<DemandPoolModuleService>(DEMAND_POOL_MODULE)
    const posts = await demand.listDemandPosts(
      { category, status: OPEN_STATUSES },
      { take: 500 }
    )
    for (const p of posts as any[]) {
      // Region scoping is best-effort: a null delivery_region counts everywhere.
      if (
        region !== "US" &&
        p.delivery_region &&
        String(p.delivery_region) !== region
      ) {
        continue
      }
      openDemandPosts++
      committedQuantity += Number(p.committed_quantity) || 0
      targetQuantity += Number(p.target_quantity) || 0
      bountyDollars += Number(p.total_bounty_amount) || 0
      if (p.cooperative_id) {
        coalitionNeeds++
      }
    }
  } catch {
    // leave demand signals at 0
  }

  // ── Wishlist breadth (best-effort via query graph) ──
  let wishlistCount = 0
  try {
    const query = scope.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
      entity: "wishlist_item",
      fields: ["id", "product.categories.name"],
      pagination: { take: 1000 },
    })
    wishlistCount = (data || []).filter((w: any) =>
      (w?.product?.categories ?? []).some(
        (c: any) =>
          typeof c?.name === "string" &&
          c.name.toLowerCase() === category.toLowerCase()
      )
    ).length
  } catch {
    wishlistCount = 0
  }

  // ── Competition (active sellers/listings in the category) ──
  let activeSellers = 0
  let activeListings = 0
  try {
    const query = scope.resolve(ContainerRegistrationKeys.QUERY)
    const { data: products } = await query.graph({
      entity: "product",
      fields: ["id", "status", "categories.name"],
      filters: { status: "published" },
      pagination: { take: 2000 },
    })
    const inCat = (products || []).filter((p: any) =>
      (p?.categories ?? []).some(
        (c: any) =>
          typeof c?.name === "string" &&
          c.name.toLowerCase() === category.toLowerCase()
      )
    )
    activeListings = inCat.length
    // Distinct sellers, when the seller link is resolvable.
    const sellerIds = new Set<string>()
    try {
      const { data: sellerProducts } = await query.graph({
        entity: "seller_product",
        fields: ["seller_id", "product.categories.name"],
        pagination: { take: 4000 },
      })
      for (const sp of sellerProducts || []) {
        const matches = (sp?.product?.categories ?? []).some(
          (c: any) =>
            typeof c?.name === "string" &&
            c.name.toLowerCase() === category.toLowerCase()
        )
        if (matches && sp?.seller_id) {
          sellerIds.add(sp.seller_id)
        }
      }
    } catch {
      // seller link unavailable; approximate sellers from listing count
    }
    activeSellers = sellerIds.size || Math.ceil(activeListings / 3)
  } catch {
    activeSellers = 0
    activeListings = 0
  }

  // ── Startup cost from the guide catalog ──
  const startup_cost_dollars = startupCostDollarsForSubject(category)

  const demand = normalizeDemand({
    openDemandPosts,
    committedQuantity,
    targetQuantity,
    bountyDollars,
    wishlistCount,
    coalitionNeeds,
  })
  const competition = normalizeCompetition({ activeSellers, activeListings })
  // Unknown startup cost → neutral 0.5 (don't over-reward or punish).
  const startupCost =
    startup_cost_dollars === null
      ? 0.5
      : normalizeStartupCost(startup_cost_dollars)

  const score = computeOpportunityScore({ demand, competition, startupCost })

  return {
    demand_raw: {
      openDemandPosts,
      committedQuantity,
      targetQuantity,
      bountyDollars,
      wishlistCount,
      coalitionNeeds,
    },
    competition_raw: { activeSellers, activeListings },
    startup_cost_dollars,
    normalized: { demand, competition, startupCost },
    score,
  }
}
