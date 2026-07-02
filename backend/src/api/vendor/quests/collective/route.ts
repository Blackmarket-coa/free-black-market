import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { VENDOR_QUEST_MODULE } from "../../../../modules/vendor-quest"
import type VendorQuestModuleService from "../../../../modules/vendor-quest/service"
import { getSellerId } from "../_helpers"

/**
 * GET /vendor/quests/collective
 *
 * Collectives the caller owns or is an enrolled member of.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const sellerId = getSellerId(req)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const service = req.scope.resolve<VendorQuestModuleService>(VENDOR_QUEST_MODULE)

  const owned = await service.listQuestCollectives({ owner_seller_id: sellerId })
  const memberEnrollments = await service.listQuestEnrollments({ seller_id: sellerId })
  const memberCollectiveIds = memberEnrollments
    .map((e) => e.collective_id)
    .filter(Boolean) as string[]
  const memberOf = memberCollectiveIds.length
    ? await service.listQuestCollectives({ id: memberCollectiveIds })
    : []

  const byId = new Map<string, (typeof owned)[number]>()
  for (const c of [...owned, ...memberOf]) byId.set(c.id, c)

  res.json({ collectives: [...byId.values()], count: byId.size })
}

/**
 * POST /vendor/quests/collective  { quest_key, title }
 *
 * Form a collective for a collective-type quest. The caller becomes the owner
 * and is auto-enrolled as the first member.
 */
export const POST = async (
  req: MedusaRequest<{ quest_key: string; title: string }>,
  res: MedusaResponse
) => {
  const sellerId = getSellerId(req)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const { quest_key, title } = req.body ?? ({} as { quest_key?: string; title?: string })
  if (!quest_key || !title) {
    return res.status(400).json({ message: "quest_key and title are required" })
  }

  const service = req.scope.resolve<VendorQuestModuleService>(VENDOR_QUEST_MODULE)
  try {
    const collective = await service.formCollective(quest_key, sellerId, title)
    // Owner joins as the first member.
    await service.enroll(sellerId, quest_key, collective.id)
    res.status(201).json({ collective })
  } catch (e) {
    res.status(400).json({ message: (e as Error).message })
  }
}
