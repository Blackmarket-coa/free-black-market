import { createLogger } from "../../../shared/logger"
import type { VendorRequest } from "../types"
const log = createLogger("api/vendor/seller-products")
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createProductsWorkflow } from "@medusajs/medusa/core-flows"
import type { CreateProductWorkflowInputDTO } from "@medusajs/framework/types"
import { sellerIdForVendorActor } from "../../../shared/seller-actor"
import { resolveAllowedListingType } from "../../../shared/listing-type-guard"
import { linkProductListingType } from "../../../shared/listing-type-link"
import { refuseOtherStoresRecords } from "../../../shared/vendor-product-body"

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

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const sellerId = (req as VendorRequest)._seller_id || (req as VendorRequest).auth_context?.actor_id

  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized" })
  }

  // By the gates' rule (shared/seller-actor.ts): a member id only while the
  // member and its store are live; a removed member's id used to be used as is.
  const resolvedSellerId = await sellerIdForVendorActor(req, sellerId)
  if (!resolvedSellerId) {
    return res.status(401).json({ message: "Unauthorized" })
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

    // Only the caller's own shipping profile and inventory items: the body
    // goes to createProductsWorkflow as it is (shared/vendor-product-body.ts).
    const refusal = await refuseOtherStoresRecords(req.scope, resolvedSellerId, productData)
    if (refusal) {
      return res.status(400).json({ message: refusal, type: "invalid_data" })
    }

    // The listing type the request names, or the seller's playbook's default
    // (the vendor panel's form names none). The route middleware checked it
    // too; read here as well so the link below records what was allowed.
    const listingTypeId = await resolveAllowedListingType(req.scope, {
      sellerId: resolvedSellerId,
      additionalData: additional_data,
    })

    const { result } = await createProductsWorkflow(req.scope).run({
      input: {
        products: [productData as CreateProductWorkflowInputDTO],
        // The caller's own store, never one the body names. Mercur's
        // productsCreated hook links the product, its inventory items and
        // the store's default shipping profile to `additional_data.seller_id`,
        // inside the workflow, as its own POST /vendor/products does. This
        // route passed the body's additional_data through and linked the
        // product and inventory itself afterwards, so the product got no
        // shipping profile (Medusa's cart completion needs one), and a body
        // naming another store's seller_id linked the product to that store.
        additional_data: { ...additional_data, seller_id: resolvedSellerId },
      },
    })

    const createdProduct = result[0]

    await linkProductListingType(req.scope, createdProduct.id, listingTypeId)

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
        "listing_type.catalog_id",
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
