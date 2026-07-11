import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { BOTANICAL_MODULE } from "../../../../modules/botanical"
import type BotanicalModuleService from "../../../../modules/botanical/service"
import { getSellerId } from "../../quests/_helpers"

/**
 * GET /vendor/botanical/formulas?pathway_id=...
 * This maker's formulas, optionally filtered to one pathway. Returns
 * `{ formulas }` to match the botanical-portal `useFormulas` hook contract.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const makerId = getSellerId(req)
  if (!makerId) return res.status(401).json({ message: "Unauthorized" })

  const pathwayId =
    typeof req.query.pathway_id === "string" ? req.query.pathway_id : undefined

  const service = req.scope.resolve<BotanicalModuleService>(BOTANICAL_MODULE)
  const formulas = await service.listFormulasForMaker(makerId, pathwayId)
  res.json({ formulas })
}
