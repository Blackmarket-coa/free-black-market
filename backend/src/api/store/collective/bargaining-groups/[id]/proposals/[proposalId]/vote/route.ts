import { createLogger } from "../../../../../../../../shared/logger"
const log = createLogger("api/store/collective/bargaining-groups/[id]/proposals/[proposalId]/vote")
import { z } from "zod"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { BARGAINING_MODULE } from "../../../../../../../../modules/bargaining"
import BargainingModuleService from "../../../../../../../../modules/bargaining/service"

const voteSchema = z.object({
  vote: z.enum(["FOR", "AGAINST", "ABSTAIN"]),
  comment: z.string().optional(),
})

// POST /store/collective/bargaining-groups/:id/proposals/:proposalId/vote
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { id, proposalId } = req.params

  try {
    const body = voteSchema.parse(req.body)
    const customerId = (req as any).auth_context?.actor_id
    if (!customerId) {
      return res.status(401).json({ error: "Unauthorized" })
    }

    const bargainingService = req.scope.resolve<BargainingModuleService>(
      BARGAINING_MODULE
    )

    const vote = await bargainingService.voteOnGroupProposal({
      proposal_id: proposalId,
      group_id: id,
      voter_id: customerId,
      vote: body.vote,
      comment: body.comment,
    })

    res.status(201).json({ vote })
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: error.issues })
    }
    log.error(`[POST vote] Error:`, error.message)
    res.status(400).json({ error: error.message })
  }
}
