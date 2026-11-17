import { createLogger } from "../../../shared/logger"
import type { VendorRequest } from "../types"
const log = createLogger("api/vendor/products")
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createProductsWorkflow } from "@medusajs/medusa/core-flows"
import type { CreateProductWorkflowInputDTO } from "@medusajs/framework/types"

import {
  resolveAllowedListingType,
  resolveSellerId,
} from "../../../shared/listing-type-guard"
import { linkProductListingType } from "../../../shared/listing-type-link"

export async function GET(
  req: MedusaRequest,
  res: MedusaResponse
) {
  const query = req.scope.resolve("query")
  const actorId = (req as VendorRequest)._seller_id || (req as VendorRequest).auth_context?.actor_id
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

    const products = sellerProducts.map((sp) => sp.product)

    res.json({
      products,
      count: products.length
    })
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch products", error: error.message })
  }
}

export async function POST(
  req: MedusaRequest,
  res: MedusaResponse
) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const actorId = (req as VendorRequest)._seller_id || (req as VendorRequest).auth_context?.actor_id
  const sellerId = await resolveSellerId(req, actorId)

  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized" })
  }

  const resolvedSellerId = sellerId

  try {
    const { additional_data, ...productData } = req.body as { additional_data?: Record<string, unknown> } & Record<string, unknown>

    // As /vendor/seller-products: the request's type or the playbook's
    // default, linked below.
    const listingTypeId = await resolveAllowedListingType(req.scope, {
      sellerId: resolvedSellerId,
      additionalData: additional_data,
    })

    // Create the product using Medusa workflow, for the caller's own store:
    // Mercur's productsCreated hook links the product, its inventory items
    // and the store's default shipping profile to `additional_data.seller_id`.
    // The body's was passed through, so a body naming another store's
    // seller_id made the product in that store, with its shipping profile
    // (measured on Postgres), and the link this route then wrote for the
    // caller did not hold.
    const { result } = await createProductsWorkflow(req.scope).run({
      input: {
        products: [productData as CreateProductWorkflowInputDTO],
        additional_data: { ...additional_data, seller_id: resolvedSellerId },
      },
    })

    const createdProduct = result[0]

    await linkProductListingType(req.scope, createdProduct.id, listingTypeId)

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
  } catch (error) {
    log.error(`Error creating product for seller ${resolvedSellerId}:`, error)
    // A listing type the playbook does not allow is the caller's to fix.
    res.status(error?.type === "invalid_data" ? 400 : 500).json({
      message: "Failed to create product",
      error: error.message,
    })
  }
}
