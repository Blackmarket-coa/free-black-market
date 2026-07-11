import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { NURSERY_VERTICAL_MODULE } from "../../../../../modules/nursery-vertical"
import type NurseryVerticalModuleService from "../../../../../modules/nursery-vertical/service"
import { getSellerId } from "../../../quests/_helpers"

/**
 * GET /vendor/plant-nursery/propagation/stratification
 * This vendor's stratification records (ending soonest first). Returns a bare
 * array to match the nursery-portal `usePropagation` hook contract.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const sellerId = getSellerId(req)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const service = req.scope.resolve<NurseryVerticalModuleService>(
    NURSERY_VERTICAL_MODULE
  )
  const stratification = await service.listStratificationForSeller(sellerId)
  res.json(stratification)
}
