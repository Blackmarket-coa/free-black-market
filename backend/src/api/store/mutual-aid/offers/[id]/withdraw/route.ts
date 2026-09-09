import { createLogger } from "../../../../../../shared/logger"
const log = createLogger("api/store/mutual-aid/offers/[id]/withdraw")
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MUTUAL_AID_MODULE } from "../../../../../../modules/mutual-aid"
import type MutualAidModuleService from "../../../../../../modules/mutual-aid/service"

/**
 * POST /store/mutual-aid/offers/:id/withdraw — the offerer takes it back down.
 *
 * The mirror of the request withdraw, with one deliberate asymmetry: only an
 * `AVAILABLE` offer can be withdrawn. A `COMMITTED` offer is a promise already
 * made to a named person who is waiting on it, so it can only be released by
 * that person withdrawing their request — which leaves a trace on the request
 * rather than silently removing the help.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params

  try {
    const offererId = (req as unknown as { auth_context?: { actor_id?: string } })
      .auth_context?.actor_id
    if (!offererId) {
      return res.status(401).json({ error: "Unauthorized" })
    }

    const service = req.scope.resolve<MutualAidModuleService>(MUTUAL_AID_MODULE)
    const offer = await service.withdrawOffer(id, offererId)

    res.json({ withdrawn: true, status: offer.status })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to withdraw"
    log.error(`[POST /store/mutual-aid/offers/${id}/withdraw] Error:`, message)
    const notFound = /not found/i.test(message)
    const forbidden = /only the offerer/i.test(message)
    const conflict = /cannot withdraw/i.test(message)
    res
      .status(notFound ? 404 : forbidden ? 403 : conflict ? 409 : 400)
      .json({ error: message })
  }
}
