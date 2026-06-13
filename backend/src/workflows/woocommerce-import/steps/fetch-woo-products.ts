import { createLogger } from "../../../shared/logger"
const log = createLogger("workflows/woocommerce-import/steps/fetch-woo-products")
import {
  createStep,
  StepResponse,
} from "@medusajs/framework/workflows-sdk"
import { WooApiClient } from "../../../modules/woocommerce-import/lib/woo-api-client"
import type { WooCredentials, WooProduct, WooVariation } from "../../../modules/woocommerce-import/types"

export type FetchWooProductsInput = {
  credentials: WooCredentials
}

export type FetchWooProductsOutput = {
  products: WooProduct[]
  variations_map: Record<number, WooVariation[]>
}

const fetchWooProductsStep = createStep(
  "fetch-woo-products-step",
  async (input: FetchWooProductsInput): Promise<StepResponse<FetchWooProductsOutput>> => {
    const client = new WooApiClient(input.credentials)

    // Fetch all products
    const products = await client.fetchAllProducts()

    // Fetch variations for all variable products
    const variationsMap: Record<number, WooVariation[]> = {}
    for (const product of products) {
      if (product.type === "variable" && product.variations.length > 0) {
        try {
          variationsMap[product.id] = await client.fetchProductVariations(product.id)
        } catch (error: any) {
          // Log but don't fail - product will be imported as simple
          log.warn(
            `Failed to fetch variations for product ${product.id}: ${error.message}`
          )
        }
      }
    }

    return new StepResponse({
      products,
      variations_map: variationsMap,
    })
  }
)

export default fetchWooProductsStep
