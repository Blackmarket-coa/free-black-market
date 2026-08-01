import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { requireSellerId } from "../../../../shared/auth-helpers"
import { featureFlagState } from "../../../../shared/feature-flags"
import { VENDOR_QUEST_MODULE } from "../../../../modules/vendor-quest"
import type VendorQuestModuleService from "../../../../modules/vendor-quest/service"

/**
 * GET /vendor/creator/quests  (always-on; creator-portal seller session)
 *
 * The creator portal's quest highlights: every catalog quest mapped to the
 * portal's `QuestHighlight` shape, with the caller's progress folded in from
 * their enrollments (0 when they haven't opted in). Sibling of the bearer-only
 * `/vendor/quests` catalog, but keyed to the creator's seller session.
 *
 * Gated on FF_VENDOR_QUESTS_V1: when the quest engine is off there are no
 * quests to surface, so this returns an empty list (never an error) and never
 * resolves the module.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const sellerId = await requireSellerId(req, res)
  if (!sellerId) return

  if (!featureFlagState.isEnabled("VENDOR_QUESTS_V1")) {
    return res.json({ quests: [], count: 0 })
  }

  const service = req.scope.resolve<VendorQuestModuleService>(VENDOR_QUEST_MODULE)
  const catalog = service.getCatalog()
  const enrollments = await service.listEnrollmentsForSeller(sellerId)

  // Highest completed-stage count per quest among the caller's non-dropped
  // enrollments. `current_stage` caches the last evaluated stage index.
  const stageByQuest = new Map<string, number>()
  for (const e of enrollments) {
    if (String(e.status) === "DROPPED") continue
    const key = String(e.quest_key)
    const stage = Number(e.current_stage ?? 0)
    stageByQuest.set(key, Math.max(stageByQuest.get(key) ?? 0, stage))
  }

  const quests = catalog.map((c) => ({
    quest_title: c.title,
    current: stageByQuest.get(c.key) ?? 0,
    required: c.stages.length,
    // Mirrors the vendor-quest engine's per-stage XP grant (STAGE_XP = 50).
    karma_reward: c.stages.length * 50,
  }))

  return res.json({ quests, count: quests.length })
}
