import { createLogger } from "../../../../../../shared/logger"
const log = createLogger("api/store/collective/demand-pools/[id]/surplus-disposition")
import { z } from "zod"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { DEMAND_POOL_MODULE } from "../../../../../../modules/demand-pool"
import DemandPoolModuleService from "../../../../../../modules/demand-pool/service"
import {
  SURPLUS_DISPOSITIONS,
  isSurplusRedirectLive,
} from "../../../../../../lib/surplus-redirect"

const schema = z.object({
  disposition: z.enum(SURPLUS_DISPOSITIONS),
})

/**
 * PUT /store/collective/demand-pools/:id/surplus-disposition
 *
 * Choose what happens to your pledge if this pool does not complete: take a
 * plain refund (the default), or send it to mutual aid.
 *
 * Deliberately a PUT the participant calls for themselves, with no pool-creator
 * or admin equivalent. The guardrail is that a redirect must be explicit and
 * opt-in — an endpoint someone else could call on a buyer's behalf would defeat
 * that no matter how the UI were written.
 *
 * Reversible until the escrow is released; the service rejects a change once
 * the money has moved.
 */
export async function PUT(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params

  try {
    const body = schema.parse(req.body)
    const customerId = (req as any).auth_context?.actor_id
    if (!customerId) {
      return res.status(401).json({ error: "Unauthorized" })
    }

    const demandPoolService = req.scope.resolve<DemandPoolModuleService>(
      DEMAND_POOL_MODULE
    )

    const participant = await demandPoolService.setSurplusDisposition(
      id,
      customerId,
      body.disposition
    )

    res.json({
      participant,
      // Say plainly what the choice will do today. With the ledger side dark,
      // a DONATE intent is recorded but the escrow still returns to the buyer,
      // and the caller should not be led to believe otherwise.
      redirect_active: isSurplusRedirectLive(),
      message:
        body.disposition === "DONATE" && !isSurplusRedirectLive()
          ? "Recorded. Mutual aid routing is not yet enabled, so this pledge would still be refunded to you."
          : undefined,
    })
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: error.issues })
    }
    log.error(
      `[PUT /store/collective/demand-pools/${id}/surplus-disposition] Error:`,
      error.message
    )
    const notFound = /not a participant/i.test(error.message || "")
    res.status(notFound ? 404 : 400).json({ error: error.message })
  }
}
