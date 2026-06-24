import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { COLLECTIVE_QUEST_MODULE } from "../../../../modules/collective-quest"
import { QuestStatus } from "../../../../modules/collective-quest/models/collective-quest"
import type CollectiveQuestModuleService from "../../../../modules/collective-quest/service"

/**
 * GET /store/collective-quest/quests?den_id=&status=
 *
 * Lists group "boss" quests for a den. Defaults to ACTIVE quests.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const service = req.scope.resolve<CollectiveQuestModuleService>(
    COLLECTIVE_QUEST_MODULE
  )
  const denId = req.query.den_id as string | undefined
  const status = (req.query.status as string | undefined) ?? QuestStatus.ACTIVE

  const filters: Record<string, unknown> = { status }
  if (denId) filters.den_id = denId

  const quests = await service.listCollectiveQuests(filters)
  res.json({ quests })
}
