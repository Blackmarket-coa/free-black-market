import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { DEMAND_POOL_MODULE } from "../../../modules/demand-pool"
import type DemandPoolModuleService from "../../../modules/demand-pool/service"

/**
 * GET /store/demand-pools
 * Public bounty/needs board for the FBM homepage. Lists open, PUBLIC
 * demand-pools (with their aggregate bounty) so the storefront can surface
 * "what to make / promote" without exposing vendor-only routes.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const demand = req.scope.resolve<DemandPoolModuleService>(DEMAND_POOL_MODULE)

  const {
    category,
    delivery_region,
    sort_by,
    limit = "20",
    offset = "0",
  } = req.query as Record<string, string>

  const allowedSorts = ["attractiveness", "deadline", "quantity", "bounty"]
  const sort = allowedSorts.includes(sort_by)
    ? (sort_by as "attractiveness" | "deadline" | "quantity" | "bounty")
    : "attractiveness"

  const posts = await demand.getOpenDemandPools({
    category: category || undefined,
    delivery_region: delivery_region || undefined,
    sort_by: sort,
    limit: Math.min(Number(limit) || 20, 100),
    offset: Number(offset) || 0,
  })

  return res.status(200).json({
    demand_pools: posts.map((p: any) => ({
      id: p.id,
      title: p.title,
      description: p.description,
      category: p.category,
      status: p.status,
      delivery_region: p.delivery_region,
      cooperative_id: p.cooperative_id ?? null,
      product_id: p.product_id ?? null,
      target_quantity: p.target_quantity,
      committed_quantity: p.committed_quantity,
      total_bounty_amount: Number(p.total_bounty_amount),
      attractiveness_score: p.attractiveness_score,
    })),
    count: posts.length,
  })
}
