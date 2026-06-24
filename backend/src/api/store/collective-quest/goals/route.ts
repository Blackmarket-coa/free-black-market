import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { COLLECTIVE_QUEST_MODULE } from "../../../../modules/collective-quest"
import type CollectiveQuestModuleService from "../../../../modules/collective-quest/service"

/**
 * GET /store/collective-quest/goals?den_id=&refresh=
 *
 * Lists shared-goal "thermometers" for a den (or all). With `refresh=true` each
 * goal's cached `current_value` is re-snapshotted from its source module first.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const service = req.scope.resolve<CollectiveQuestModuleService>(
    COLLECTIVE_QUEST_MODULE
  )
  const denId = req.query.den_id as string | undefined
  const refresh = req.query.refresh === "true"

  const filters: Record<string, unknown> = {}
  if (denId) filters.den_id = denId

  let goals = await service.listCollectiveGoals(filters)

  if (refresh) {
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
    goals = await Promise.all(
      goals.map((g) => service.recomputeGoal(g.id as string, query as never))
    )
  }

  res.json({ goals })
}
