import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  PRODUCT_ARCHETYPE_MODULE,
  ProductArchetypeCode,
} from "../../../../../modules/product-archetype"
import type ProductArchetypeService from "../../../../../modules/product-archetype/service"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params
  if (!id) return res.status(400).json({ message: "Product ID is required" })

  const service = req.scope.resolve<ProductArchetypeService>(PRODUCT_ARCHETYPE_MODULE)
  const archetype = await service.getArchetypeForProduct(id)
  return res.json({ archetype })
}

type Body = { code: ProductArchetypeCode }

export async function PUT(req: MedusaRequest<Body>, res: MedusaResponse) {
  const { id } = req.params
  const body = (req.validatedBody || req.body) as Body

  if (!id) return res.status(400).json({ message: "Product ID is required" })
  if (!body?.code) return res.status(400).json({ message: "code is required" })
  if (!Object.values(ProductArchetypeCode).includes(body.code)) {
    return res.status(400).json({ message: `Invalid archetype code: ${body.code}` })
  }

  const service = req.scope.resolve<ProductArchetypeService>(PRODUCT_ARCHETYPE_MODULE)
  const assignment = await service.assignArchetypeByCode(id, body.code)
  const archetype = await service.getArchetypeForProduct(id)
  return res.json({ assignment, archetype })
}
