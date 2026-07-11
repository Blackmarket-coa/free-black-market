import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { BOTANICAL_MODULE } from "../../../../modules/botanical"
import type BotanicalModuleService from "../../../../modules/botanical/service"
import { getSellerId } from "../../quests/_helpers"

/**
 * GET /vendor/botanical/raw-materials
 * This maker's raw-material stock, alphabetical. Returns `{ materials }` to
 * match the botanical-portal `useRawMaterials` hook contract.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const makerId = getSellerId(req)
  if (!makerId) return res.status(401).json({ message: "Unauthorized" })

  const service = req.scope.resolve<BotanicalModuleService>(BOTANICAL_MODULE)
  const materials = await service.listMaterialsForMaker(makerId)
  res.json({ materials })
}
