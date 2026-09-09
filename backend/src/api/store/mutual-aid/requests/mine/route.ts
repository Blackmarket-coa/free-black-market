import { createLogger } from "../../../../../shared/logger"
const log = createLogger("api/store/mutual-aid/requests/mine")
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MUTUAL_AID_MODULE } from "../../../../../modules/mutual-aid"
import type MutualAidModuleService from "../../../../../modules/mutual-aid/service"
import { toOwnAid } from "../../../../../lib/aid-location"

/**
 * GET /store/mutual-aid/requests/mine — the caller's own asks, in every status.
 *
 * The public board withholds `requester_id`, which is right, and had the
 * side-effect of making a person's own rows unfindable: the withdraw endpoint
 * takes an id that nothing gave them back except the 201 at creation. So there
 * was a way to take an ask down and no way to reach it.
 *
 * Every status, not just OPEN. "Your asks" that hid the withdrawn and expired
 * ones would suggest they had vanished rather than closed, and a matched one is
 * exactly what a person wants to see.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const customerId = (req as unknown as { auth_context?: { actor_id?: string } })
      .auth_context?.actor_id
    if (!customerId) {
      return res.status(401).json({ error: "Unauthorized" })
    }

    const service = req.scope.resolve<MutualAidModuleService>(MUTUAL_AID_MODULE)
    // Scoped to the caller in the query, never filtered afterwards — the
    // filter is the authorisation here, so it has to be what the database is
    // asked, not something applied to a wider result.
    const requests = await service.listMutualAidRequests({
      requester_id: customerId,
    })

    res.json({
      requests: requests.map((r) => toOwnAid(r as never)),
      count: requests.length,
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed"
    log.error("[GET /store/mutual-aid/requests/mine] Error:", message)
    res.status(500).json({ error: "Failed to retrieve your aid requests" })
  }
}
