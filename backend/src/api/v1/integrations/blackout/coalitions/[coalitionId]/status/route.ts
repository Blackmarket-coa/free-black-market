import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { createLogger } from "../../../../../../../shared/logger"
import { requireEntitlementsAuth } from "../../../../../../../lib/blackout-entitlements-auth"
import { COOPERATIVE_MODULE } from "../../../../../../../modules/cooperative"
import type CooperativeService from "../../../../../../../modules/cooperative/service"

const log = createLogger("api/v1/integrations/blackout/coalitions/status")

const BodySchema = z.object({ status: z.enum(["active", "taken_down"]) }).strict()

/**
 * PUT /v1/integrations/blackout/coalitions/:coalitionId/status
 *
 * Blackout took a coalition down, or put it back. FBM pulls the collective
 * storefront to match.
 *
 * Archiving on Blackout never reached here, which is part of why a takedown
 * needed to be a different thing: a coalition could be shut on one side and
 * still be selling on the other.
 *
 * Flips the two flags the public storefront route already gates on rather than
 * inventing a third state, so there is one answer to "is this live".
 */
export async function PUT(req: MedusaRequest, res: MedusaResponse) {
  if (!requireEntitlementsAuth(req, res)) return

  const coalitionId = String(req.params.coalitionId || "").trim()
  if (!coalitionId) {
    return res.status(400).json({ code: "bad_request", message: "coalitionId is required" })
  }

  const parsed = BodySchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    return res.status(400).json({
      code: "bad_request",
      message: "Invalid status payload",
      details: parsed.error.flatten(),
    })
  }

  const cooperativeService = req.scope.resolve<CooperativeService>(COOPERATIVE_MODULE)
  const [cooperative] = await cooperativeService.listCooperatives({
    blackout_coalition_id: coalitionId,
  })
  if (!cooperative) {
    return res.status(404).json({
      code: "cooperative_unlinked",
      message: "No FBM cooperative is linked to this coalition",
    })
  }

  const live = parsed.data.status === "active"
  await cooperativeService.updateCooperatives([
    {
      id: cooperative.id,
      is_active: live,
      public_storefront_enabled: live,
    },
  ])

  log.info("coalition status mirrored", {
    coalition_id: coalitionId,
    cooperative_id: cooperative.id,
    status: parsed.data.status,
  })

  return res.json({ updated: true, cooperative_id: cooperative.id, status: parsed.data.status })
}
