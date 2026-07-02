import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { VENDOR_QUEST_MODULE } from "../../../../../../modules/vendor-quest"
import type VendorQuestModuleService from "../../../../../../modules/vendor-quest/service"
import { getSellerId } from "../../../_helpers"
import { evaluateCollectiveFromConsent } from "../../_helpers"

/**
 * POST /vendor/quests/collective/:id/packet[?format=html]
 *
 * Generate the joint packet from the aggregate of consenting members. Owner-only.
 * Succeeds only once the collective's final stage gate is open.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const sellerId = getSellerId(req)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const service = req.scope.resolve<VendorQuestModuleService>(VENDOR_QUEST_MODULE)
  const collective = await service.retrieveQuestCollective(req.params.id)
  if (collective.owner_seller_id !== sellerId) {
    return res.status(403).json({ message: "Only the collective owner can generate the joint packet" })
  }

  const agg = await evaluateCollectiveFromConsent(req, collective as any)
  if (!agg.aggregate) {
    return res.status(400).json({ message: "No consenting members to aggregate yet" })
  }

  try {
    const { export: exportData, html } = await service.generateCollectivePacket(
      collective as any,
      agg.aggregate
    )
    if (req.query.format === "html") {
      res.setHeader("Content-Type", "text/html; charset=utf-8")
      return res.send(html)
    }
    res.json({ packet: exportData, html })
  } catch (e: any) {
    res.status(400).json({ message: e.message })
  }
}
