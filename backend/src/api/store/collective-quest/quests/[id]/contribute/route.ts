import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { COLLECTIVE_QUEST_MODULE } from "../../../../../../modules/collective-quest"
import type CollectiveQuestModuleService from "../../../../../../modules/collective-quest/service"

const contributeSchema = z.object({
  hp_reduction: z.number().int().positive(),
  /** The member opts in to appear in the (relative-to-self) den activity view. */
  leaderboard_opt_in: z.boolean().optional(),
  source_module: z.string().optional(),
  source_id: z.string().optional(),
})

/**
 * POST /store/collective-quest/quests/:id/contribute
 *
 * A member pledges effort toward a group boss quest. Member-facing pledges are
 * recorded **unverified** — boss HP only drops once a trusted backend path
 * verifies the contribution (ADR-0004), so members can't self-farm progress.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const customerId = (req as any).auth_context?.actor_id
  if (!customerId) {
    return res.status(401).json({ error: "Authentication required" })
  }

  try {
    const body = contributeSchema.parse(req.body)
    const service = req.scope.resolve<CollectiveQuestModuleService>(
      COLLECTIVE_QUEST_MODULE
    )

    const quest = await service.contributeToQuest({
      quest_id: req.params.id,
      customer_id: customerId,
      hp_reduction: body.hp_reduction,
      verified: false,
      source_module: body.source_module,
      source_id: body.source_id,
      metadata: { leaderboard_opt_in: body.leaderboard_opt_in ?? false },
    })

    return res.status(201).json({ quest })
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: error.issues })
    }
    const message = error instanceof Error ? error.message : "Unknown error"
    return res.status(message.includes("not active") ? 409 : 400).json({ error: message })
  }
}
