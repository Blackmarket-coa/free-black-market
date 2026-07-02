import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { VENDOR_QUEST_MODULE } from "../../../../modules/vendor-quest"
import type VendorQuestModuleService from "../../../../modules/vendor-quest/service"
import { buildSubstrate } from "../../../../modules/vendor-quest/substrate/build"
import { getSellerId, makeAwardXp } from "../_helpers"

/**
 * GET /vendor/quests/enrollments
 *
 * A vendor's enrollments, each re-evaluated against the LIVE substrate so the
 * UI shows current stage + what's missing. Also syncs any newly-passed gate
 * (persists stage events, best-effort XP).
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const sellerId = getSellerId(req)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const service = req.scope.resolve<VendorQuestModuleService>(VENDOR_QUEST_MODULE)
  const enrollments = await service.listEnrollmentsForSeller(sellerId)

  // Only build the (potentially expensive) substrate if there are active quests.
  const active = enrollments.filter((e) => e.status === "ACTIVE")
  let substrate = null as Awaited<ReturnType<typeof buildSubstrate>> | null
  if (active.length) substrate = await buildSubstrate(sellerId, req.scope)

  const awardXp = makeAwardXp(req)
  type SyncResult = Awaited<ReturnType<typeof service.syncProgress>>
  const items: Array<{
    enrollment: (typeof enrollments)[number]
    evaluation: SyncResult | null
  }> = []
  for (const e of enrollments) {
    let evaluation: SyncResult | null = null
    if (e.status === "ACTIVE" && substrate) {
      evaluation = await service.syncProgress(e, substrate, { awardXp })
    }
    items.push({ enrollment: e, evaluation })
  }

  res.json({ enrollments: items, count: items.length })
}

/**
 * POST /vendor/quests/enrollments  { quest_key }
 *
 * Opt into a quest. Never auto-enrolled; idempotent per active (seller, quest).
 */
export const POST = async (
  req: MedusaRequest<{ quest_key: string; collective_id?: string }>,
  res: MedusaResponse
) => {
  const sellerId = getSellerId(req)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const { quest_key, collective_id } = req.body ?? ({} as { quest_key?: string; collective_id?: string })
  if (!quest_key) return res.status(400).json({ message: "quest_key is required" })

  const service = req.scope.resolve<VendorQuestModuleService>(VENDOR_QUEST_MODULE)
  try {
    const enrollment = await service.enroll(sellerId, quest_key, collective_id)
    res.status(201).json({ enrollment })
  } catch (e) {
    res.status(400).json({ message: (e as Error).message })
  }
}
