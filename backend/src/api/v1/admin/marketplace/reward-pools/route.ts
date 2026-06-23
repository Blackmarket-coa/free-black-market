import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { CREATOR_REWARDS_MODULE } from "../../../../../modules/creator-rewards"
import type CreatorRewardsService from "../../../../../modules/creator-rewards/service"

/**
 * GET /v1/admin/marketplace/reward-pools
 *
 * Admin listing of all reward pools across programs. Filters: ?status=,
 * ?program_id=, ?limit=, ?offset=.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const limit = Math.min(
    Math.max(parseInt((req.query.limit as string) || "50", 10) || 50, 1),
    200
  )
  const offset = Math.max(parseInt((req.query.offset as string) || "0", 10) || 0, 0)

  const filter: Record<string, unknown> = {}
  if (req.query.status) filter.status = req.query.status as string
  if (req.query.program_id) filter.program_id = req.query.program_id as string

  const rewards = req.scope.resolve<CreatorRewardsService>(CREATOR_REWARDS_MODULE)
  const pools = await rewards.listRewardPools(filter, {
    take: limit,
    skip: offset,
    order: { created_at: "DESC" } as const,
  })
  return res.status(200).json({ pools, limit, offset })
}
