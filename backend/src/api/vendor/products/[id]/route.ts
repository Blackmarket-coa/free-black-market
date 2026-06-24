import { createLogger } from "../../../../shared/logger"
import type { VendorRequest } from "../../types"
const log = createLogger("api/vendor/products/[id]")
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { updateProductsWorkflow } from "@medusajs/medusa/core-flows"

async function resolveSellerId(req: MedusaRequest, actorId?: string): Promise<string | undefined> {
  if (!actorId) {
    return undefined
  }

  if (!actorId.startsWith("mem_")) {
    return actorId
  }

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

// Core product fields - avoiding relations that may not exist
const productFields = [
  "id",
  "title",
  "subtitle",
  "status",
  "external_id",
  "description",
  "handle",
  "is_giftcard",
  "discountable",
  "thumbnail",
  "collection_id",
  "type_id",
  "weight",
  "length",
  "height",
  "width",
  "hs_code",
  "origin_country",
  "mid_code",
  "material",
  "metadata",
  "images.*",
  "variants.*",
  "variants.prices.*",
  "variants.inventory_items.*",
]

export async function GET(
  req: MedusaRequest,
  res: MedusaResponse
) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const actorId = (req as VendorRequest)._seller_id || (req as VendorRequest).auth_context?.actor_id
  const sellerId = await resolveSellerId(req, actorId)
  const { id } = req.params

  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized" })
  }

  if (!id) {
    return res.status(400).json({ message: "Product ID is required" })
  }

  try {
    // Verify seller owns this product before returning it
    const { data: sellerProducts } = await query.graph({
      entity: "seller",
      fields: ["products.id"],
      filters: { id: sellerId },
    })

    const ownedProductIds = sellerProducts?.[0]?.products?.map((p) => p?.id) || []
    if (!ownedProductIds.includes(id)) {
      return res.status(403).json({ message: "You do not have access to this product" })
    }

    // Fetch the full product with all fields including images
    const { data: products } = await query.graph({
      entity: "product",
      fields: productFields,
      filters: {
        id: id
      }
    })

    if (products && products.length > 0) {
      return res.json({
        product: products[0]
      })
    }

    return res.status(404).json({ message: "Product not found" })
  } catch (error) {
    log.error(`Error fetching product ${id} for seller ${sellerId}:`, error)
    res.status(500).json({
      message: "Failed to fetch product"
    })
  }
}

export async function POST(
  req: MedusaRequest,
  res: MedusaResponse
) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const actorId = (req as VendorRequest)._seller_id || (req as VendorRequest).auth_context?.actor_id
  const sellerId = await resolveSellerId(req, actorId)
  const { id } = req.params

  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized" })
  }

  if (!id) {
    return res.status(400).json({ message: "Product ID is required" })
  }

  try {
    // Verify seller owns this product before allowing update
    const { data: sellerProducts } = await query.graph({
      entity: "seller",
      fields: ["products.id"],
      filters: { id: sellerId },
    })

    const ownedProductIds = sellerProducts?.[0]?.products?.map((p) => p?.id) || []
    if (!ownedProductIds.includes(id)) {
      return res.status(403).json({ message: "You do not have access to this product" })
    }

    const { additional_data, ...update } = req.body as { additional_data?: Record<string, unknown> } & Record<string, unknown>

    // Run the update workflow
    const { result } = await updateProductsWorkflow(req.scope).run({
      input: {
        update,
        selector: { id },
        additional_data,
      },
    })

    // Fetch updated product with all fields
    const { data: products } = await query.graph({
      entity: "product",
      fields: productFields,
      filters: {
        id: result[0]?.id || id
      }
    })

    if (products && products.length > 0) {
      return res.json({
        product: products[0]
      })
    }

    return res.status(404).json({ message: "Product not found after update" })
  } catch (error) {
    log.error(`Error updating product ${id} for seller ${sellerId}:`, error)
    res.status(500).json({
      message: "Failed to update product"
    })
  }
}

export async function DELETE(
  req: MedusaRequest,
  res: MedusaResponse
) {
  const actorId = (req as VendorRequest)._seller_id || (req as VendorRequest).auth_context?.actor_id
  const sellerId = await resolveSellerId(req, actorId)
  const { id } = req.params

  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized" })
  }

  if (!id) {
    return res.status(400).json({ message: "Product ID is required" })
  }

  try {
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

    // Verify seller owns this product before allowing delete
    const { data: sellerProducts } = await query.graph({
      entity: "seller",
      fields: ["products.id"],
      filters: { id: sellerId },
    })

    const ownedProductIds = sellerProducts?.[0]?.products?.map((p) => p?.id) || []
    if (!ownedProductIds.includes(id)) {
      return res.status(403).json({ message: "You do not have access to this product" })
    }

    const { deleteProductsWorkflow } = await import("@medusajs/medusa/core-flows")

    await deleteProductsWorkflow(req.scope).run({
      input: {
        ids: [id]
      },
    })

    return res.json({
      id,
      object: "product",
      deleted: true
    })
  } catch (error) {
    log.error(`Error deleting product ${id} for seller ${sellerId}:`, error)
    res.status(500).json({
      message: "Failed to delete product"
    })
  }
}
