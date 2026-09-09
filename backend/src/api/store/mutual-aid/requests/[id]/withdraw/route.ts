import { createLogger } from "../../../../../../shared/logger"
const log = createLogger("api/store/mutual-aid/requests/[id]/withdraw")
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MUTUAL_AID_MODULE } from "../../../../../../modules/mutual-aid"
import type MutualAidModuleService from "../../../../../../modules/mutual-aid/service"
import { announceAidRequestChanged } from "../../../../../../lib/aid-events"

/**
 * POST /store/mutual-aid/requests/:id/withdraw — the asker takes it back down.
 *
 * `WITHDRAWN` was declared on the status enum and reachable by nobody: there
 * was no endpoint and no service method that could write it. A need met off
 * the platform, or posted in a moment someone would rather undo, stayed on the
 * public board indefinitely.
 *
 * Requester-only, enforced in the service — a helper who no longer wants the
 * commitment does not get to close somebody else's ask.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params

  try {
    const requesterId = (req as unknown as { auth_context?: { actor_id?: string } })
      .auth_context?.actor_id
    if (!requesterId) {
      return res.status(401).json({ error: "Unauthorized" })
    }

    const service = req.scope.resolve<MutualAidModuleService>(MUTUAL_AID_MODULE)
    const request = await service.withdrawRequest(id, requesterId)

    // So a mirrored copy of this ask leaves Blackout's board too, rather than
    // sitting open and sending someone to help with something already handled.
    await announceAidRequestChanged(req, id)

    res.json({ withdrawn: true, status: request.status })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to withdraw"
    log.error(`[POST /store/mutual-aid/requests/${id}/withdraw] Error:`, message)
    const notFound = /not found/i.test(message)
    const forbidden = /only the requester/i.test(message)
    const conflict = /cannot withdraw/i.test(message)
    res
      .status(notFound ? 404 : forbidden ? 403 : conflict ? 409 : 400)
      .json({ error: message })
  }
}
