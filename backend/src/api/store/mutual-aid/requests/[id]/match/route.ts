import { createLogger } from "../../../../../../shared/logger"
const log = createLogger("api/store/mutual-aid/requests/[id]/match")
import { z } from "zod"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MUTUAL_AID_MODULE } from "../../../../../../modules/mutual-aid"
import type MutualAidModuleService from "../../../../../../modules/mutual-aid/service"

const schema = z.object({ offer_id: z.string().optional() })

/**
 * POST /store/mutual-aid/requests/:id/match — a helper commits to a request.
 *
 * First-come, decided by a `status = 'OPEN'` predicate in the service. The
 * guard matters more here than in an ordinary marketplace: someone waiting on
 * aid who is told twice that help is coming, and then receives none, is worse
 * off than someone who was never matched at all.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params

  try {
    const body = schema.parse(req.body ?? {})
    const helperId = (req as unknown as { auth_context?: { actor_id?: string } })
      .auth_context?.actor_id
    if (!helperId) {
      return res.status(401).json({ error: "Unauthorized" })
    }

    const service = req.scope.resolve<MutualAidModuleService>(MUTUAL_AID_MODULE)
    const request = await service.matchRequest({
      request_id: id,
      offer_id: body.offer_id ?? null,
      helper_id: helperId,
    })

    res.json({
      matched: true,
      status: request.status,
      // The helper now needs to reach the requester, but this response is not
      // where contact details belong — that exchange goes through the existing
      // chat surface, so a match does not hand out a location.
      next_step: "Coordinate through chat; the requester confirms once help arrives.",
    })
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: error.issues })
    }
    const message = error instanceof Error ? error.message : "Failed to match"
    log.error(`[POST /store/mutual-aid/requests/${id}/match] Error:`, message)
    const notFound = /not found/i.test(message)
    const conflict = /already been matched/i.test(message)
    res.status(notFound ? 404 : conflict ? 409 : 400).json({ error: message })
  }
}
