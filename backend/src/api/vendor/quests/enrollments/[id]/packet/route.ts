import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { VENDOR_QUEST_MODULE } from "../../../../../../modules/vendor-quest"
import type VendorQuestModuleService from "../../../../../../modules/vendor-quest/service"
import { buildSubstrate } from "../../../../../../modules/vendor-quest/substrate/build"
import { getSellerId } from "../../../_helpers"

/**
 * POST /vendor/quests/enrollments/:id/packet
 *
 * Generate the exportable packet for a quest. Only succeeds once the final stage
 * gate is open. Returns structured JSON (authoritative) and rendered HTML
 * (print-to-PDF). `?format=html` returns the HTML document directly for the
 * browser to print/save.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const sellerId = getSellerId(req)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const service = req.scope.resolve<VendorQuestModuleService>(VENDOR_QUEST_MODULE)
  const enrollment = await service.retrieveQuestEnrollment(req.params.id)
  if (enrollment.seller_id !== sellerId) {
    return res.status(404).json({ message: "Not found" })
  }

  try {
    const substrate = await buildSubstrate(sellerId, req.scope)
    const { export: exportData, html } = await service.generatePacket(
      enrollment as any,
      substrate
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
