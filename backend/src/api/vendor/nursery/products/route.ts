import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { NURSERY_VERTICAL_MODULE } from "../../../../modules/nursery-vertical"
import type NurseryVerticalModuleService from "../../../../modules/nursery-vertical/service"
import { getSellerId } from "../../quests/_helpers"

/** GET /vendor/nursery/products — this vendor's nursery listing attributes. */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const sellerId = getSellerId(req)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const service = req.scope.resolve<NurseryVerticalModuleService>(NURSERY_VERTICAL_MODULE)
  const attributes = await service.listForSeller(sellerId)
  res.json({ attributes, count: attributes.length })
}

interface UpsertBody {
  product_id: string
  subtype: string
  edible_use?: string[]
  medicinal_use?: string[]
  hardiness_zone?: string
  propagation_method?: string
  channel_fit?: string[]
  cost_to_produce?: number
  tag_data?: Record<string, unknown>
}

/** POST /vendor/nursery/products — create/update nursery attributes for a product. */
export const POST = async (req: MedusaRequest<UpsertBody>, res: MedusaResponse) => {
  const sellerId = getSellerId(req)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const b = req.body ?? ({} as UpsertBody)
  if (!b.product_id || !b.subtype) {
    return res.status(400).json({ message: "product_id and subtype are required" })
  }

  const service = req.scope.resolve<NurseryVerticalModuleService>(NURSERY_VERTICAL_MODULE)
  const { product_id, ...data } = b
  const attribute = await service.upsertForProduct(
    sellerId,
    product_id,
    data as Record<string, unknown>
  )
  res.status(201).json({ attribute })
}
