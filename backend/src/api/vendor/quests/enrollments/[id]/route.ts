import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { VENDOR_QUEST_MODULE } from "../../../../../modules/vendor-quest"
import type VendorQuestModuleService from "../../../../../modules/vendor-quest/service"
import { buildSubstrate } from "../../../../../modules/vendor-quest/substrate/build"
import { getSellerId, makeAwardXp } from "../../_helpers"

/** GET /vendor/quests/enrollments/:id — enrollment detail + live evaluation. */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const sellerId = getSellerId(req)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const service = req.scope.resolve<VendorQuestModuleService>(VENDOR_QUEST_MODULE)
  const enrollment = await service.retrieveQuestEnrollment(req.params.id)
  if (enrollment.seller_id !== sellerId) {
    return res.status(404).json({ message: "Not found" })
  }

  let evaluation: Awaited<ReturnType<typeof service.syncProgress>> | null = null
  if (enrollment.status === "ACTIVE") {
    const substrate = await buildSubstrate(sellerId, req.scope)
    evaluation = await service.syncProgress(enrollment, substrate, {
      awardXp: makeAwardXp(req),
    })
  }
  res.json({ enrollment, evaluation })
}

/**
 * DELETE /vendor/quests/enrollments/:id — drop a quest.
 *
 * Sets status = DROPPED; NEVER deletes the vendor's substrate records.
 */
export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const sellerId = getSellerId(req)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const service = req.scope.resolve<VendorQuestModuleService>(VENDOR_QUEST_MODULE)
  const enrollment = await service.retrieveQuestEnrollment(req.params.id)
  if (enrollment.seller_id !== sellerId) {
    return res.status(404).json({ message: "Not found" })
  }

  const dropped = await service.drop(req.params.id)
  res.json({ enrollment: dropped })
}
