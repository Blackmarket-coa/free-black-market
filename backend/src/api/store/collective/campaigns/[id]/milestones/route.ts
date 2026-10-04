import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { getErrorMessage, requireSharedGoalHost } from "../_shared-goal-host"

const bodySchema = z.object({
  title: z.string().min(1),
  target_amount_cents: z.number().int().positive(),
  unit: z.string().min(1).optional(),
  sort_order: z.number().int().min(0).optional(),
  impact_summary: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

/**
 * POST /store/collective/campaigns/:id/milestones — host-only. Adds a goal
 * milestone (target in integer cents). `reached_at` is set by the service when
 * the contributed total meets the target, never by this route.
 * Gated by FF_SHARED_GOAL_COALITION_V1 in middlewares.ts.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const service = await requireSharedGoalHost(req, res)
    if (!service) return

    const body = bodySchema.parse(req.body)
    const milestone = await service.addMilestone({
      campaign_id: req.params.id,
      title: body.title,
      target_amount_cents: body.target_amount_cents,
      unit: body.unit,
      sort_order: body.sort_order,
      impact_summary: body.impact_summary ?? null,
      metadata: body.metadata,
    })
    return res.status(201).json({ milestone })
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: error.issues })
    }
    return res.status(400).json({ error: getErrorMessage(error) })
  }
}
