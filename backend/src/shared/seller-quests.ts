import type { MedusaContainer } from "@medusajs/framework/types"
import { VENDOR_QUEST_MODULE } from "../modules/vendor-quest"
import type VendorQuestModuleService from "../modules/vendor-quest/service"
import { getQuestDefinition } from "../modules/vendor-quest/definitions"

/**
 * XP awarded per completed quest stage — mirrors the private `STAGE_XP` in
 * `modules/vendor-quest/service.ts` (the value written to
 * `quest_stage_event.xp_awarded`).
 */
const QUEST_STAGE_XP = 50

export interface QuestHighlight {
  quest_title: string
  current: number
  required: number
  karma_reward: number
}

/**
 * The portal dashboards' quest widget: the seller's ACTIVE quest enrollments
 * with cached stage progress against each quest's stage-gate count.
 * Best-effort — [] when the quest module is unavailable or the seller has no
 * enrollments.
 */
export async function getSellerQuestHighlights(
  container: MedusaContainer,
  sellerId: string,
  limit = 3
): Promise<QuestHighlight[]> {
  try {
    const quests = container.resolve<VendorQuestModuleService>(VENDOR_QUEST_MODULE)
    const enrollments = await quests.listEnrollmentsForSeller(sellerId)
    return enrollments
      .filter((e) => e.status === "ACTIVE")
      .slice(0, limit)
      .map((e) => {
        const def = getQuestDefinition(e.quest_key)
        return {
          quest_title: def?.title ?? e.quest_key,
          current: Number(e.current_stage ?? 0),
          required: def?.stageGates?.length ?? 0,
          karma_reward: QUEST_STAGE_XP,
        }
      })
  } catch {
    return []
  }
}
