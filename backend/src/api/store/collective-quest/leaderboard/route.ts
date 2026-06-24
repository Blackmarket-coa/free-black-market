import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { COLLECTIVE_QUEST_MODULE } from "../../../../modules/collective-quest"
import type CollectiveQuestModuleService from "../../../../modules/collective-quest/service"

/**
 * GET /store/collective-quest/leaderboard?den_id=
 *
 * The opt-in, relative-to-self den activity view. Only members who opted in
 * appear; entries carry a self-relative band, never a competitive rank
 * (ADR-0004). `den_id` is required.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const denId = req.query.den_id as string | undefined
  if (!denId) {
    return res.status(400).json({ error: "den_id is required" })
  }

  const service = req.scope.resolve<CollectiveQuestModuleService>(
    COLLECTIVE_QUEST_MODULE
  )
  const entries = await service.getDenLeaderboard(denId, { optInOnly: true })
  return res.json({ entries })
}
