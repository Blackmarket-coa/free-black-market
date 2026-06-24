import { createLogger } from "../../../shared/logger"
import type { VendorRequest } from "../types"
const log = createLogger("api/vendor/seller-products")
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { createProductsWorkflow } from "@medusajs/medusa/core-flows"
import type { CreateProductWorkflowInputDTO } from "@medusajs/framework/types"
import { SELLER_MODULE } from "@mercurjs/b2c-core/modules/seller"

type VariantPrice = {
  amount?: number | string | null
  currency_code?: string | null
}

function validateAndNormalizeVariantPrices(
  variants: Array<{ prices?: VariantPrice[] } & Record<string, unknown>> = []
) {
  const errors: string[] = []

  const normalizedVariants = variants.map((variant, variantIndex: number) => {
    if (!Array.isArray(variant?.prices)) {
      return variant
    }

    const normalizedPrices = variant.prices.map((price: VariantPrice, priceIndex: number) => {
      const normalizedAmount = Number(price?.amount)

      if (!Number.isFinite(normalizedAmount) || normalizedAmount < 0) {
        errors.push(
          `variants[${variantIndex}].prices[${priceIndex}].amount must be a non-negative number`
        )
      }

      if (!price?.currency_code) {
        errors.push(
          `variants[${variantIndex}].prices[${priceIndex}].currency_code is required`
        )
      }

      return {
        ...price,
        amount: normalizedAmount,
      }
    })

    return {
      ...variant,
      prices: normalizedPrices,
    }
  })

  return {
    errors,
    variants: normalizedVariants,
  }
}

function getErrorStatus(error) {
  const knownStatus =
    error?.statusCode ||
    error?.status_code ||
    error?.status ||
    error?.cause?.statusCode ||
    error?.cause?.status_code

  if (typeof knownStatus === "number" && knownStatus >= 400 && knownStatus < 600) {
    return knownStatus
  }

  if (error?.type === "invalid_data" || error?.name === "MedusaError") {
    return 400
  }

  return 500
}

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
        .flatMap((variant) => variant.inventory_items || [])
        .map((item) => item.inventory_item_id)
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
      } catch (error) {
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

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const remoteLink = req.scope.resolve(ContainerRegistrationKeys.REMOTE_LINK)
  const sellerId = (req as VendorRequest)._seller_id || (req as VendorRequest).auth_context?.actor_id

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
    const { additional_data, ...productData } = req.body as { additional_data?: Record<string, unknown> } & Record<string, unknown>

    if (Array.isArray(productData?.variants)) {
      const { errors, variants } = validateAndNormalizeVariantPrices(productData.variants)

      if (errors.length) {
        return res.status(400).json({
          message: "Failed to create product",
          error: "Invalid variant price payload",
          details: errors,
        })
      }

      productData.variants = variants
    }

    const { result } = await createProductsWorkflow(req.scope).run({
      input: {
        products: [productData as CreateProductWorkflowInputDTO],
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
    } catch (linkError) {
      log.warn(
        `Could not create seller-product link for ${createdProduct.id}: ${linkError.message}`
      )
    }

    const { data: products } = await query.graph({
      entity: "product",
      fields: [
        "id",
        "title",
        "subtitle",
        "status",
        "description",
        "handle",
        "thumbnail",
        "collection_id",
        "type_id",
        "metadata",
        "images.*",
        "variants.*",
        "variants.prices.*",
      ],
      filters: { id: createdProduct.id },
    })

    return res.json({
      product: products?.[0] || createdProduct,
    })
  } catch (error) {
    const status = getErrorStatus(error)

    log.error("Error creating product for seller", {
      sellerId: resolvedSellerId,
      status,
      message: error?.message,
      type: error?.type,
      name: error?.name,
      stack: error?.stack,
      cause: error?.cause,
    })

    res.status(status).json({
      message: "Failed to create product",
      error: error?.message || "Unknown error",
      type: error?.type,
    })
  }
}
