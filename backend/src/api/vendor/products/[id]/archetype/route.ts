import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  PRODUCT_ARCHETYPE_MODULE,
  ProductArchetypeCode,
} from "../../../../../modules/product-archetype"
import type ProductArchetypeService from "../../../../../modules/product-archetype/service"

async function resolveSellerId(req: MedusaRequest, actorId?: string): Promise<string | undefined> {
  if (!actorId) return undefined
  if (!actorId.startsWith("mem_")) return actorId
  try {
    const pgConnection = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
    const memberResult = await pgConnection.raw(
      `SELECT seller_id FROM member WHERE id = ? LIMIT 1`,
      [actorId]
    )
    return memberResult.rows?.[0]?.seller_id || actorId
  } catch {
    return actorId
  }
}

async function verifySellerOwnsProduct(req: MedusaRequest, sellerId: string, productId: string) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: sellerProducts } = await query.graph({
    entity: "seller",
    fields: ["products.id"],
    filters: { id: sellerId },
  })
  const owned = sellerProducts?.[0]?.products?.map((p: any) => p.id) || []
  return owned.includes(productId)
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const actorId = (req as any)._seller_id || (req as any).auth_context?.actor_id
  const sellerId = await resolveSellerId(req, actorId)
  const { id } = req.params

  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })
  if (!id) return res.status(400).json({ message: "Product ID is required" })

  if (!(await verifySellerOwnsProduct(req, sellerId, id))) {
    return res.status(403).json({ message: "You do not have access to this product" })
  }

  const service = req.scope.resolve<ProductArchetypeService>(PRODUCT_ARCHETYPE_MODULE)
  const archetype = await service.getArchetypeForProduct(id)
  return res.json({ archetype })
}

type Body = { code: ProductArchetypeCode }

export async function PUT(req: MedusaRequest<Body>, res: MedusaResponse) {
  const actorId = (req as any)._seller_id || (req as any).auth_context?.actor_id
  const sellerId = await resolveSellerId(req, actorId)
  const { id } = req.params
  const body = (req.validatedBody || req.body) as Body

  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })
  if (!id) return res.status(400).json({ message: "Product ID is required" })
  if (!body?.code) return res.status(400).json({ message: "code is required" })

  if (!Object.values(ProductArchetypeCode).includes(body.code)) {
    return res.status(400).json({ message: `Invalid archetype code: ${body.code}` })
  }

  if (!(await verifySellerOwnsProduct(req, sellerId, id))) {
    return res.status(403).json({ message: "You do not have access to this product" })
  }

  const service = req.scope.resolve<ProductArchetypeService>(PRODUCT_ARCHETYPE_MODULE)
  const assignment = await service.assignArchetypeByCode(id, body.code)
  const archetype = await service.getArchetypeForProduct(id)
  return res.json({ assignment, archetype })
}
