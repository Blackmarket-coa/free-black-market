import { createLogger } from "../../../../../shared/logger"
const log = createLogger("api/store/mutual-aid/offers/mine")
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MUTUAL_AID_MODULE } from "../../../../../modules/mutual-aid"
import type MutualAidModuleService from "../../../../../modules/mutual-aid/service"
import { toOwnAid } from "../../../../../lib/aid-location"

/**
 * GET /store/mutual-aid/offers/mine — the caller's own offers, in every status.
 *
 * The mirror of the requests version, for the same reason: `offerer_id` is
 * withheld from the public board, so without this an offerer cannot find the
 * offer they posted in order to withdraw it.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const customerId = (req as unknown as { auth_context?: { actor_id?: string } })
      .auth_context?.actor_id
    if (!customerId) {
      return res.status(401).json({ error: "Unauthorized" })
    }

    const service = req.scope.resolve<MutualAidModuleService>(MUTUAL_AID_MODULE)
    const offers = await service.listMutualAidOffers({ offerer_id: customerId })

    res.json({
      offers: offers.map((o) => toOwnAid(o as never)),
      count: offers.length,
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed"
    log.error("[GET /store/mutual-aid/offers/mine] Error:", message)
    res.status(500).json({ error: "Failed to retrieve your aid offers" })
  }
}
