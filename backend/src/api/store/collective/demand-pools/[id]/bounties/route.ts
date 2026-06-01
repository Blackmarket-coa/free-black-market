import { z } from "zod"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { DEMAND_POOL_MODULE } from "../../../../../../modules/demand-pool"
import DemandPoolModuleService from "../../../../../../modules/demand-pool/service"

const addBountySchema = z.object({
  objective: z.enum([
    "FIND_SUPPLIER",
    "NEGOTIATE_PRICE",
    "RECRUIT_BUYERS",
    "COORDINATE_LOGISTICS",
    "FINALIZE_DEAL",
  ]),
  amount: z.number().positive(),
  currency_code: z.string().default("USD"),
  milestones: z
    .array(
      z.object({
        description: z.string(),
        percentage: z.number().min(0).max(100),
        condition: z.string(),
      })
    )
    .refine(
      (milestones) =>
        milestones.length === 0 ||
        milestones.reduce((sum, m) => sum + m.percentage, 0) === 100,
      { message: "Bounty milestone percentages must sum to 100" }
    )
    .optional(),
  visibility: z.enum(["PUBLIC", "RESTRICTED"]).optional(),
})

// GET /store/collective/demand-pools/:id/bounties
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params

  try {
    const demandPoolService = req.scope.resolve<DemandPoolModuleService>(
      DEMAND_POOL_MODULE
    )

    const actorId = (req as any).auth_context?.actor_id as string | undefined

    const posts = await demandPoolService.listDemandPosts({ id })
    const creatorId = posts.length > 0 ? posts[0].creator_id : undefined

    const bounties = await demandPoolService.listDemandBounties({
      demand_post_id: id,
    })

    // Visibility filter: PUBLIC bounties are always visible. RESTRICTED
    // bounties are visible only to the pool creator, the bounty's
    // contributor, or its assignee.
    const visibleBounties = bounties.filter((b) => {
      if (b.visibility !== "RESTRICTED") return true
      if (!actorId) return false
      return (
        actorId === creatorId ||
        actorId === b.contributor_id ||
        actorId === b.assignee_id
      )
    })

    res.json({ bounties: visibleBounties })
  } catch (error: any) {
    console.error(`[GET /store/collective/demand-pools/${id}/bounties] Error:`, error.message)
    res.status(500).json({ error: "Failed to retrieve bounties" })
  }
}

// POST /store/collective/demand-pools/:id/bounties
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params

  try {
    const body = addBountySchema.parse(req.body)
    const customerId = (req as any).auth_context?.actor_id
    if (!customerId) {
      return res.status(401).json({ error: "Unauthorized" })
    }

    const demandPoolService = req.scope.resolve<DemandPoolModuleService>(
      DEMAND_POOL_MODULE
    )

    // Authorize: only the pool creator or an existing participant may
    // add a bounty to this pool.
    const posts = await demandPoolService.listDemandPosts({ id })
    if (posts.length === 0) {
      return res.status(404).json({ error: "Demand pool not found" })
    }
    const isCreator = posts[0].creator_id === customerId
    let isParticipant = false
    if (!isCreator) {
      const participants = await demandPoolService.listDemandParticipants({
        demand_post_id: id,
        customer_id: customerId,
      })
      isParticipant = participants.length > 0
    }
    if (!isCreator && !isParticipant) {
      return res
        .status(403)
        .json({ error: "Not authorized to add a bounty to this pool" })
    }

    const bounty = await demandPoolService.addBounty({
      demand_post_id: id,
      contributor_id: customerId,
      contributor_type: "CUSTOMER",
      objective: body.objective,
      amount: body.amount,
      currency_code: body.currency_code,
      milestones: body.milestones,
      visibility: body.visibility,
    })

    res.status(201).json({ bounty })
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: error.errors })
    }
    console.error(`[POST /store/collective/demand-pools/${id}/bounties] Error:`, error.message)
    res.status(400).json({ error: error.message })
  }
}
