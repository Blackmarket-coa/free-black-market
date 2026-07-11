import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { BOTANICAL_MODULE } from "../../../../../modules/botanical"
import type BotanicalModuleService from "../../../../../modules/botanical/service"
import { getSellerId } from "../../../quests/_helpers"

/**
 * GET /vendor/botanical/pathways/templates
 * The built-in pathway template catalog. Returns `{ templates }` to match the
 * botanical-portal `usePathwayTemplates` hook contract.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const makerId = getSellerId(req)
  if (!makerId) return res.status(401).json({ message: "Unauthorized" })

  const service = req.scope.resolve<BotanicalModuleService>(BOTANICAL_MODULE)
  res.json({ templates: service.listTemplates() })
}
