import { createLogger } from "../../../../../shared/logger"
const log = createLogger("api/admin/collective/bargaining-groups/[id]")
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { BARGAINING_MODULE } from "../../../../../modules/bargaining"
import BargainingModuleService from "../../../../../modules/bargaining/service"

// GET /admin/collective/bargaining-groups/:id
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const { id } = req.params

  try {
    const bargainingService = req.scope.resolve<BargainingModuleService>(
      BARGAINING_MODULE
    )

    const details = await bargainingService.getGroupDetails(id)
    res.json({ bargaining_group: details })
  } catch (error: any) {
    log.error(`[GET /admin/collective/bargaining-groups/${id}] Error:`, error.message)
    res.status(error.message.includes("not found") ? 404 : 500).json({
      error: error.message,
    })
  }
}

// POST /admin/collective/bargaining-groups/:id (admin actions)
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const { id } = req.params

  try {
    const { action, proposal_id } = req.body as any
    const bargainingService = req.scope.resolve<BargainingModuleService>(
      BARGAINING_MODULE
    )

    if (action === "finalize_vote" && proposal_id) {
      const result = await bargainingService.finalizeProposalVote(proposal_id)
      return res.json({ result, message: "Proposal vote finalized" })
    }

    if (action === "disband") {
      const updated = await bargainingService.transitionGroupStatus(id, "DISBANDED")
      return res.json({ bargaining_group: updated, message: "Group disbanded" })
    }

    res.status(400).json({ error: "Invalid action" })
  } catch (error: any) {
    log.error(`[POST /admin/collective/bargaining-groups/${id}] Error:`, error.message)
    res.status(400).json({ error: error.message })
  }
}
