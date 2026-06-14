import {
  createStep,
  StepResponse,
} from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { SELLER_MODULE } from "@mercurjs/b2c-core/modules/seller"
import { WooToMedusaTransformer } from "../../../modules/woocommerce-import/lib/woo-to-medusa-transformer"
import type { WooProduct, WooVariation, ImportResult } from "../../../modules/woocommerce-import/types"

export type TransformAndCreateProductsInput = {
  products: WooProduct[]
  variations_map: Record<number, WooVariation[]>
  seller_id: string
  currency: string
  import_as_draft: boolean
}

const transformAndCreateProductsStep = createStep(
  "transform-and-create-products-step",
  async (
    input: TransformAndCreateProductsInput,
    { container }
  ): Promise<StepResponse<ImportResult, string[]>> => {
    const productService = container.resolve(Modules.PRODUCT)
    const remoteLink = container.resolve(ContainerRegistrationKeys.REMOTE_LINK)
    const logger = container.resolve("logger")

    const transformer = new WooToMedusaTransformer(input.currency)
    const result: ImportResult = {
      imported: 0,
      failed: 0,
      skipped: 0,
      errors: [],
    }
    const createdProductIds: string[] = []

    for (const wooProduct of input.products) {
      try {
        // Skip unsupported types
        if (wooProduct.type !== "simple" && wooProduct.type !== "variable") {
          result.skipped++
          continue
        }

        const variations = input.variations_map[wooProduct.id] || undefined
        const transformed = transformer.transformProduct(
          wooProduct,
          variations,
          input.import_as_draft
        )

        // Build the create product input compatible with MedusaJS v2
        const productData: any = {
          title: transformed.title,
          subtitle: transformed.subtitle,
          description: transformed.description,
          handle: transformed.handle,
          status: transformed.status,
          is_giftcard: false,
          discountable: true,
          weight: transformed.weight,
          length: transformed.length,
          width: transformed.width,
          height: transformed.height,
          images: transformed.images,
          tags: transformed.tags,
          metadata: transformed.metadata,
        }

        // Add options for variable products
        if (transformed.options.length > 0) {
          productData.options = transformed.options.map((opt) => ({
            title: opt.title,
            values: opt.values,
          }))
        }

        // Add variants
        productData.variants = transformed.variants.map((v) => ({
          title: v.title,
          sku: v.sku,
          manage_inventory: v.manage_inventory,
          allow_backorder: v.allow_backorder,
          weight: v.weight,
          length: v.length,
          width: v.width,
          height: v.height,
          prices: v.prices,
          options: v.options,
          metadata: v.metadata,
        }))

        // Create the product using Medusa product service
        const [createdProduct] = await productService.createProducts([productData])
        createdProductIds.push(createdProduct.id)

        // Link product to seller using MercurJS seller_product relationship
        try {
          await remoteLink.create({
            [SELLER_MODULE]: { seller_id: input.seller_id },
            [Modules.PRODUCT]: { product_id: createdProduct.id },
          })
        } catch (linkError: any) {
          // If the link pattern is different, try the alternative
          logger.warn(
            `Could not create seller-product link for ${createdProduct.id}: ${linkError.message}. ` +
            `The product was created but may not be associated with the vendor.`
          )
        }

        result.imported++
        logger.info(
          `Imported WooCommerce product "${wooProduct.name}" (${wooProduct.id}) -> ${createdProduct.id}`
        )
      } catch (error: any) {
        result.failed++
        result.errors.push({
          product_name: wooProduct.name,
          woo_product_id: wooProduct.id,
          error: error.message,
        })
        logger.warn(
          `Failed to import WooCommerce product "${wooProduct.name}" (${wooProduct.id}): ${error.message}`
        )
      }
    }

    return new StepResponse(result, createdProductIds)
  },
  async (createdProductIds, { container }) => {
    // Compensation: delete created products if workflow fails
    if (!createdProductIds || createdProductIds.length === 0) return

    const productService = container.resolve(Modules.PRODUCT)
    try {
      await productService.deleteProducts(createdProductIds)
    } catch (_error) {
      // Best effort cleanup
    }
  }
)

export default transformAndCreateProductsStep
