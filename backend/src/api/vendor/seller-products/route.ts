import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { createProductsWorkflow } from "@medusajs/medusa/core-flows"
import { SELLER_MODULE } from "@mercurjs/b2c-core/modules/seller"

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


export async function POST(
  req: MedusaRequest,
  res: MedusaResponse
) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const remoteLink = req.scope.resolve(ContainerRegistrationKeys.REMOTE_LINK)
  const sellerId = (req as any)._seller_id || (req as any).auth_context?.actor_id

  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized" })
  }

  // Resolve actual seller ID if we have a member ID
  let resolvedSellerId = sellerId
  if (sellerId.startsWith("mem_")) {
    try {
      const pgConnection = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
      const memberResult = await pgConnection.raw(
        `SELECT seller_id FROM member WHERE id = ? LIMIT 1`,
        [sellerId]
      )
      resolvedSellerId = memberResult.rows?.[0]?.seller_id || sellerId
    } catch {
      // Continue with original ID
    }
  }

  try {
    const { additional_data, ...productData } = req.body as any

    if (Array.isArray(productData?.variants)) {
      productData.variants = productData.variants.map((variant: any) => {
        const prices = Array.isArray(variant?.prices)
          ? variant.prices.filter((price: any) => {
              const amount = Number(price?.amount)
              return Number.isFinite(amount) && amount >= 0
            })
          : variant?.prices

        return {
          ...variant,
          prices,
        }
      })
    }

    const { result } = await createProductsWorkflow(req.scope).run({
      input: {
        products: [productData],
        additional_data,
      },
    })

    const createdProduct = result[0]

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
    const status =
      error?.type === "invalid_data" || error?.name === "MedusaError" ? 400 : 500

    res.status(status).json({
      message: "Failed to create product",
      error: error.message,
    })
  }
}
