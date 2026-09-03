import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { PRODUCTION_COSTING_MODULE } from "../../../../modules/production-costing"
import type ProductionCostingModuleService from "../../../../modules/production-costing/service"
import { getSellerId } from "../../quests/_helpers"

/** DELETE /vendor/production-costs/:id — remove a cost entry (seller-scoped). */
export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const sellerId = getSellerId(req)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const service = req.scope.resolve<ProductionCostingModuleService>(
    PRODUCTION_COSTING_MODULE
  )

  let entry: { seller_id: string } | null = null
  try {
    entry = await service.retrieveProductionCostEntry(req.params.id)
  } catch {
    return res.status(404).json({ message: "Not found" })
  }
  if (!entry || entry.seller_id !== sellerId) {
    return res.status(404).json({ message: "Not found" })
  }

  await service.deleteProductionCostEntries(req.params.id)
  res.json({ id: req.params.id, deleted: true })
}
