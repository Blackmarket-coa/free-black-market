import { createLogger } from "../../../../../shared/logger"
import type { VendorRequest } from "../../../types"
const log = createLogger("api/vendor/products/[id]/status")
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { updateProductsWorkflow } from "@medusajs/medusa/core-flows"
import type { ProductStatus } from "@medusajs/framework/types"

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

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const actorId = (req as VendorRequest)._seller_id || (req as VendorRequest).auth_context?.actor_id
  const sellerId = await resolveSellerId(req, actorId)
  const { id } = req.params

  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized" })
  }

  const { status } = req.body as { status: string }

  if (!["draft", "published", "proposed", "rejected"].includes(status)) {
    return res.status(400).json({ message: "Invalid status. Must be one of: draft, published, proposed, rejected" })
  }

  try {
    // Verify ownership
    const { data: sellerProducts } = await query.graph({
      entity: "seller",
      fields: ["products.id"],
      filters: { id: sellerId },
    })

    const ownedProductIds = sellerProducts?.[0]?.products?.map((p) => p.id) || []
    if (!ownedProductIds.includes(id)) {
      return res.status(403).json({ message: "You do not have access to this product" })
    }

    await updateProductsWorkflow(req.scope).run({
      input: {
        selector: { id },
        update: { status: status as ProductStatus },
      },
    })

    const { data: products } = await query.graph({
      entity: "product",
      fields: ["id", "title", "status"],
      filters: { id },
    })

    return res.json({ product: products?.[0] })
  } catch (error) {
    log.error(`Error updating product status ${id}:`, error)
    res.status(500).json({ message: "Failed to update product status" })
  }
}
