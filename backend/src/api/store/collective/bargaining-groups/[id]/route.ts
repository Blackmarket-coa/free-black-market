import { createLogger } from "../../../../../shared/logger"
const log = createLogger("api/store/collective/bargaining-groups/[id]")
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { BARGAINING_MODULE } from "../../../../../modules/bargaining"
import BargainingModuleService from "../../../../../modules/bargaining/service"

// GET /store/collective/bargaining-groups/:id
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params

  try {
    const bargainingService = req.scope.resolve<BargainingModuleService>(
      BARGAINING_MODULE
    )

    const details = await bargainingService.getGroupDetails(id)
    res.json({ bargaining_group: details })
  } catch (error: any) {
    log.error(`[GET /store/collective/bargaining-groups/${id}] Error:`, error.message)
    res.status(error.message.includes("not found") ? 404 : 500).json({
      error: error.message,
    })
  }
}

// PATCH /store/collective/bargaining-groups/:id
export async function PATCH(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params

  try {
    const customerId = (req as any).auth_context?.actor_id
    if (!customerId) {
      return res.status(401).json({ error: "Unauthorized" })
    }

    const bargainingService = req.scope.resolve<BargainingModuleService>(
      BARGAINING_MODULE
    )

    const groups = await bargainingService.listBargainingGroups({ id })
    if (groups.length === 0) {
      return res.status(404).json({ error: "Group not found" })
    }
    if (groups[0].organizer_id !== customerId) {
      return res.status(403).json({ error: "Only the organizer can modify this group" })
    }

    const { action } = req.body as any

    if (action === "open") {
      const updated = await bargainingService.transitionGroupStatus(id, "OPEN")
      return res.json({ bargaining_group: updated })
    }

    if (action === "disband") {
      const updated = await bargainingService.transitionGroupStatus(id, "DISBANDED")
      return res.json({ bargaining_group: updated })
    }

    if (action === "complete") {
      const updated = await bargainingService.transitionGroupStatus(id, "COMPLETED")
      return res.json({ bargaining_group: updated })
    }

    res.status(400).json({ error: "Invalid action" })
  } catch (error: any) {
    log.error(`[PATCH /store/collective/bargaining-groups/${id}] Error:`, error.message)
    res.status(400).json({ error: error.message })
  }
}
