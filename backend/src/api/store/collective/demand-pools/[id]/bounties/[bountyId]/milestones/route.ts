import { z } from "zod"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { DEMAND_POOL_MODULE } from "../../../../../../../../modules/demand-pool"
import DemandPoolModuleService from "../../../../../../../../modules/demand-pool/service"
import { getCollectiveHawalaService } from "../../../../../../../../services/collective-hawala"

const completeMilestoneSchema = z.object({
  milestone_index: z.number().int().min(0),
  proof: z
    .object({
      url: z.string().optional(),
      note: z.string().optional(),
    })
    .optional(),
})

// POST /store/collective/demand-pools/:id/bounties/:bountyId/milestones
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { id, bountyId } = req.params

  try {
    const body = completeMilestoneSchema.parse(req.body)
    const actorId = (req as any).auth_context?.actor_id
    if (!actorId) {
      return res.status(401).json({ error: "Unauthorized" })
    }

    const demandPoolService = req.scope.resolve<DemandPoolModuleService>(
      DEMAND_POOL_MODULE
    )

    // Authorize: only the demand pool creator may complete milestones.
    const posts = await demandPoolService.listDemandPosts({ id })
    if (posts.length === 0) {
      return res.status(404).json({ error: "Demand pool not found" })
    }
    if (posts[0].creator_id !== actorId) {
      return res
        .status(403)
        .json({ error: "Only the pool creator can complete milestones" })
    }

    const hawalaService = getCollectiveHawalaService(req.scope)
    const result = await hawalaService.completeAndPayMilestone({
      demand_post_id: id,
      bounty_id: bountyId,
      milestone_index: body.milestone_index,
      proof: body.proof,
    })

    res.json(result)
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: error.errors })
    }
    console.error(
      `[POST /store/collective/demand-pools/${id}/bounties/${bountyId}/milestones] Error:`,
      error.message
    )
    res.status(400).json({ error: error.message })
  }
}
