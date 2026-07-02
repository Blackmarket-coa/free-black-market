import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { PRODUCTION_LEDGER_MODULE } from "../../../../modules/production-ledger"
import type ProductionLedgerModuleService from "../../../../modules/production-ledger/service"
import { getSellerId } from "../../quests/_helpers"

/** DELETE /vendor/production-batches/:id — remove a production batch (seller-scoped). */
export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const sellerId = getSellerId(req)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const service = req.scope.resolve<ProductionLedgerModuleService>(PRODUCTION_LEDGER_MODULE)
  const batch = await service.retrieveProductionBatch(req.params.id)
  if (batch.seller_id !== sellerId) return res.status(404).json({ message: "Not found" })

  await service.deleteProductionBatches(req.params.id)
  res.json({ id: req.params.id, deleted: true })
}
