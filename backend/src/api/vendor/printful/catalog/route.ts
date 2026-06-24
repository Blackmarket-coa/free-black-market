import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import PrintfulClient from "../../../../modules/printful-fulfillment/client"
import { getPrintfulApiKey, getPrintfulStoreId } from "../../../../modules/printful-fulfillment/env"

const DEFAULT_LIMIT = 25

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const apiKey = getPrintfulApiKey()

  if (!apiKey) {
    return res.status(400).json({
      message: "PRINTFUL_API_KEY is not configured on the backend.",
    })
  }

  const rawLimit = Number((req.query as Record<string, unknown>)?.limit || DEFAULT_LIMIT)
  const rawOffset = Number((req.query as Record<string, unknown>)?.offset || 0)

  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : DEFAULT_LIMIT
  const offset = Number.isFinite(rawOffset) ? Math.max(rawOffset, 0) : 0

  try {
    const client = new PrintfulClient({
      apiKey,
      storeId: getPrintfulStoreId(),
    })

    const products = await client.getCatalogProducts(limit, offset)

    const normalized = Array.isArray(products)
      ? products.map((product: any) => ({
          id: product?.id,
          name: product?.title || product?.name || `Printful Product ${product?.id}`,
          brand: product?.brand,
          model: product?.model,
          image: product?.image || product?.thumbnail_url,
          variants: product?.variants || [],
        }))
      : []

    return res.status(200).json({
      products: normalized,
      count: normalized.length,
      limit,
      offset,
    })
  } catch (error) {
    return res.status(500).json({
      message: "Failed to fetch Printful catalog products",
      error: error.message,
    })
  }
}
