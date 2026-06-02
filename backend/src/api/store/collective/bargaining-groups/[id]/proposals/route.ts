import { z } from "zod"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { BARGAINING_MODULE } from "../../../../../../modules/bargaining"
import BargainingModuleService from "../../../../../../modules/bargaining/service"

const counterOfferSchema = z.object({
  proposal_id: z.string().min(1),
  counter_terms: z.record(z.string(), z.unknown()),
})

// GET /store/collective/bargaining-groups/:id/proposals
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params

  try {
    const bargainingService = req.scope.resolve<BargainingModuleService>(
      BARGAINING_MODULE
    )

    const proposals = await bargainingService.listBargainingProposals({
      group_id: id,
    })

    res.json({ proposals })
  } catch (error: any) {
    console.error(`[GET proposals] Error:`, error.message)
    res.status(500).json({ error: "Failed to retrieve proposals" })
  }
}

// POST /store/collective/bargaining-groups/:id/proposals (counter-offer)
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params

  try {
    const body = counterOfferSchema.parse(req.body)
    const customerId = (req as any).auth_context?.actor_id
    if (!customerId) {
      return res.status(401).json({ error: "Unauthorized" })
    }

    const bargainingService = req.scope.resolve<BargainingModuleService>(
      BARGAINING_MODULE
    )

    const counter = await bargainingService.counterOfferGroupProposal(
      body.proposal_id,
      customerId,
      body.counter_terms
    )

    res.status(201).json({ proposal: counter })
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: error.issues })
    }
    console.error(`[POST counter-offer] Error:`, error.message)
    res.status(400).json({ error: error.message })
  }
}
