import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { createLogger } from "../../../../../../../shared/logger"
import { requireEntitlementsAuth } from "../../../../../../../lib/blackout-entitlements-auth"
import { COOPERATIVE_MODULE } from "../../../../../../../modules/cooperative"
import type CooperativeService from "../../../../../../../modules/cooperative/service"

const log = createLogger("api/v1/integrations/blackout/coalitions/milestones")

const BodySchema = z
  .object({
    drives_completed: z.number().int().min(0).max(100_000),
    contributing_members: z.number().int().min(0).max(1_000_000),
    raised_cents: z.number().int().min(0),
  })
  .strict()

/**
 * PUT /v1/integrations/blackout/coalitions/:coalitionId/milestones
 *
 * Blackout reports a coalition's joint-drive totals; FBM mirrors them onto the
 * cooperative that is the coalition's FBM face, where the coalition quest
 * (Q16) reads them.
 *
 * A PUT of absolute totals, not a POST of increments, on purpose: Blackout
 * owns the drives and can always recompute the true count, so a lost or
 * duplicated delivery self-heals on the next push. An increment API would
 * drift permanently on a single retry.
 *
 * Counts and cents only. Who contributed and how much stays on Blackout —
 * FBM needs the shape of the coalition's effort to open a gate, not its
 * members' giving history.
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
      message: "Invalid milestone payload",
      details: parsed.error.flatten(),
    })
  }

  const cooperativeService = req.scope.resolve<CooperativeService>(COOPERATIVE_MODULE)
  const [cooperative] = await cooperativeService.listCooperatives({
    blackout_coalition_id: coalitionId,
  })
  if (!cooperative) {
    // Not an error on Blackout's side: plenty of coalitions never link an FBM
    // cooperative. 404 tells the caller to stop pushing rather than retry.
    return res.status(404).json({
      code: "cooperative_unlinked",
      message: "No FBM cooperative is linked to this coalition",
    })
  }

  await cooperativeService.updateCooperatives([
    {
      id: cooperative.id,
      coalition_drives_completed: parsed.data.drives_completed,
      coalition_contributing_members: parsed.data.contributing_members,
      coalition_drive_raised_cents: parsed.data.raised_cents,
      coalition_milestones_at: new Date(),
    },
  ])

  log.info("coalition milestones mirrored", {
    coalition_id: coalitionId,
    cooperative_id: cooperative.id,
    drives_completed: parsed.data.drives_completed,
  })

  return res.json({ updated: true, cooperative_id: cooperative.id })
}
