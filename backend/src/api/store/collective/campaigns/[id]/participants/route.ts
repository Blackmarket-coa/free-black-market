import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { CampaignParticipantRole } from "../../../../../../modules/collective-campaign"
import { getErrorMessage, requireSharedGoalHost } from "../_shared-goal-host"

const bodySchema = z
  .object({
    partner_org_key: z.string().regex(/^[a-z0-9][a-z0-9_]{1,63}$/).optional(),
    seller_id: z.string().min(1).optional(),
    role: z.enum([
      CampaignParticipantRole.COLLECTIVE,
      CampaignParticipantRole.PARTNER,
      CampaignParticipantRole.SPONSOR,
    ]),
    pledged_amount_cents: z.number().int().min(0).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((body) => Boolean(body.partner_org_key || body.seller_id), {
    message: "partner_org_key or seller_id is required",
  })

/**
 * POST /store/collective/campaigns/:id/participants — host-only. Adds an
 * organisation to a shared-goal campaign with a role and an optional pledge in
 * integer cents. No money moves: a pledge is a statement, and contributions are
 * attributed by the Connect webhook from direct charges on the org's own
 * connected account. Gated by FF_SHARED_GOAL_COALITION_V1 in middlewares.ts.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const service = await requireSharedGoalHost(req, res)
    if (!service) return

    const body = bodySchema.parse(req.body)
    const participant = await service.addParticipant({
      campaign_id: req.params.id,
      partner_org_key: body.partner_org_key ?? null,
      seller_id: body.seller_id ?? null,
      role: body.role,
      pledged_amount_cents: body.pledged_amount_cents,
      metadata: body.metadata,
    })
    return res.status(201).json({ participant })
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: error.issues })
    }
    return res.status(400).json({ error: getErrorMessage(error) })
  }
}
