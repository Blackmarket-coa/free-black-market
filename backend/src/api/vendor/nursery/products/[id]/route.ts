import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { NURSERY_VERTICAL_MODULE } from "../../../../../modules/nursery-vertical"
import type NurseryVerticalModuleService from "../../../../../modules/nursery-vertical/service"
import { getSellerId } from "../../../quests/_helpers"

/** PUT /vendor/nursery/products/:id — update an attribute row (seller-scoped). */
export const PUT = async (req: MedusaRequest, res: MedusaResponse) => {
  const sellerId = getSellerId(req)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const service = req.scope.resolve<NurseryVerticalModuleService>(NURSERY_VERTICAL_MODULE)
  const attr = await service.retrieveNurseryProductAttribute(req.params.id)
  if (attr.seller_id !== sellerId) return res.status(404).json({ message: "Not found" })

  const { id, seller_id, product_id, ...data } = (req.body ?? {}) as Record<string, unknown>
  await service.updateNurseryProductAttributes({ id: req.params.id, ...data })
  const attribute = await service.retrieveNurseryProductAttribute(req.params.id)
  res.json({ attribute })
}

/** DELETE /vendor/nursery/products/:id — remove nursery attributes for a product. */
export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const sellerId = getSellerId(req)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const service = req.scope.resolve<NurseryVerticalModuleService>(NURSERY_VERTICAL_MODULE)
  const attr = await service.retrieveNurseryProductAttribute(req.params.id)
  if (attr.seller_id !== sellerId) return res.status(404).json({ message: "Not found" })

  await service.deleteNurseryProductAttributes(req.params.id)
  res.json({ id: req.params.id, deleted: true })
}
