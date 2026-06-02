import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { createProductsWorkflow } from "@medusajs/medusa/core-flows"
import { SELLER_MODULE } from "@mercurjs/b2c-core/modules/seller"

import { resolveSellerId } from "../../../shared/listing-type-guard"

async function linkSellerInventoryItems(
  req: MedusaRequest,
  sellerId: string,
  productId: string
) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const remoteLink = req.scope.resolve(ContainerRegistrationKeys.REMOTE_LINK)

  const { data: variants } = await query.graph({
    entity: "product_variant",
    fields: ["inventory_items.inventory_item_id"],
    filters: { product_id: productId },
  })

  const inventoryItemIds = [
    ...new Set(
      (variants || [])
        .flatMap((variant: any) => variant.inventory_items || [])
        .map((item: any) => item.inventory_item_id)
        .filter(Boolean)
    ),
  ]

  await Promise.all(
    inventoryItemIds.map(async (inventory_item_id) => {
      try {
        await remoteLink.create({
          [SELLER_MODULE]: { seller_id: sellerId },
          [Modules.INVENTORY]: { inventory_item_id },
        })
      } catch (error: any) {
        const message = error?.message || ""
        const isAlreadyLinked =
          message.includes("already exists") || message.includes("duplicate")

        if (!isAlreadyLinked) {
          throw error
        }
      }
    })
  )
}

export async function GET(
  req: MedusaRequest,
  res: MedusaResponse
) {
  const query = req.scope.resolve("query")
  const actorId = (req as any)._seller_id || (req as any).auth_context?.actor_id
  const sellerId = await resolveSellerId(req, actorId)

  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized" })
  }

  try {
    // Fetch products linked to this seller via seller_product
    const { data: sellerProducts } = await query.graph({
      entity: "seller_product",
      fields: ["product.*"],
      filters: {
        seller_id: sellerId
      },
    })

    const products = sellerProducts.map((sp: any) => sp.product)

    res.json({
      products,
      count: products.length
    })
  } catch (error: any) {
    res.status(500).json({ message: "Failed to fetch products", error: error.message })
  }
}

export async function POST(
  req: MedusaRequest,
  res: MedusaResponse
) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const remoteLink = req.scope.resolve(ContainerRegistrationKeys.REMOTE_LINK)
  const actorId = (req as any)._seller_id || (req as any).auth_context?.actor_id
  const sellerId = await resolveSellerId(req, actorId)

  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized" })
  }

  const resolvedSellerId = sellerId

  try {
    const { additional_data, ...productData } = req.body as any

    // Create the product using Medusa workflow
    const { result } = await createProductsWorkflow(req.scope).run({
      input: {
        products: [productData],
        additional_data,
      },
    })

    const createdProduct = result[0]

    // Link product to seller
    try {
      await remoteLink.create({
        [SELLER_MODULE]: { seller_id: resolvedSellerId },
        [Modules.PRODUCT]: { product_id: createdProduct.id },
      })

      await linkSellerInventoryItems(req, resolvedSellerId, createdProduct.id)
    } catch (linkError: any) {
      console.warn(
        `Could not create seller-product link for ${createdProduct.id}: ${linkError.message}`
      )
    }

    // Fetch the full product with relations
    const { data: products } = await query.graph({
      entity: "product",
      fields: [
        "id", "title", "subtitle", "status", "description", "handle",
        "thumbnail", "collection_id", "type_id", "metadata",
        "images.*", "variants.*", "variants.prices.*",
      ],
      filters: { id: createdProduct.id },
    })

    return res.json({
      product: products?.[0] || createdProduct,
    })
  } catch (error: any) {
    console.error(`Error creating product for seller ${resolvedSellerId}:`, error)
    res.status(500).json({
      message: "Failed to create product",
      error: error.message,
    })
  }
}
