import { createLogger } from "../../../../../../shared/logger"
const log = createLogger("api/store/mutual-aid/requests/[id]/confirm")
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import type { IEventBusModuleService } from "@medusajs/framework/types"
import { MUTUAL_AID_MODULE } from "../../../../../../modules/mutual-aid"
import type MutualAidModuleService from "../../../../../../modules/mutual-aid/service"

/**
 * POST /store/mutual-aid/requests/:id/confirm — the requester confirms help arrived.
 *
 * Only the requester can call this, enforced in the service. A helper marking
 * their own good deed complete is the self-attestation that makes a reputation
 * score worthless, and this is precisely what awards reputation: the emitted
 * event is what closes Phase 2's third mode, putting mutual aid help on the
 * same character sheet as bounty fills and group buys.
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
    const request = await service.confirmFulfilled(id, requesterId)

    // Best-effort: an event-bus hiccup must not fail a confirmation the
    // requester has already given.
    try {
      const helperId = request.matched_helper_id as string | null
      if (helperId) {
        const eventBus = req.scope.resolve<IEventBusModuleService>(Modules.EVENT_BUS)
        await eventBus.emit({
          name: "mutual_aid.fulfilled",
          data: {
            request_id: id,
            helper_id: helperId,
            requester_id: requesterId,
            category: (request.category as string | null) ?? null,
            urgency: (request.urgency as string | null) ?? null,
          },
        })
      }
    } catch {
      /* event emission is best-effort */
    }

    res.json({ confirmed: true, status: request.status })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to confirm"
    log.error(`[POST /store/mutual-aid/requests/${id}/confirm] Error:`, message)
    const notFound = /not found/i.test(message)
    const forbidden = /only the requester/i.test(message)
    res.status(notFound ? 404 : forbidden ? 403 : 400).json({ error: message })
  }
}
