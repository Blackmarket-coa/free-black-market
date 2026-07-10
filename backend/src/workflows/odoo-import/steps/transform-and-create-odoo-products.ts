import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { SELLER_MODULE } from "@mercurjs/b2c-core/modules/seller"
import { OdooToMedusaTransformer } from "../../../modules/odoo-import/lib/odoo-to-medusa-transformer"
import type { OdooProduct, OdooImportResult } from "../../../modules/odoo-import/types"

export type TransformAndCreateOdooInput = {
  products: OdooProduct[]
  seller_id: string
  currency: string
  import_as_draft: boolean
}

const transformAndCreateOdooProductsStep = createStep(
  "transform-and-create-odoo-products-step",
  async (
    input: TransformAndCreateOdooInput,
    { container }
  ): Promise<StepResponse<OdooImportResult, string[]>> => {
    const productService = container.resolve(Modules.PRODUCT)
    const remoteLink = container.resolve(ContainerRegistrationKeys.REMOTE_LINK)
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const logger = container.resolve("logger")

    const transformer = new OdooToMedusaTransformer(input.currency, input.seller_id)
    const result: OdooImportResult = {
      imported: 0,
      updated: 0,
      failed: 0,
      skipped: 0,
      errors: [],
    }
    const createdProductIds: string[] = []

    // Existing Odoo-imported products for this seller → idempotent re-import.
    const existingByOdooId = new Map<string, string>()
    try {
      const { data: existing } = await query.graph({
        entity: "seller_product",
        fields: ["product.id", "product.metadata"],
        filters: { seller_id: input.seller_id },
      })
      for (const sp of existing || []) {
        const odooId = (sp as any)?.product?.metadata?.odoo_product_id
        const productId = (sp as any)?.product?.id
        if (odooId && productId) existingByOdooId.set(String(odooId), productId)
      }
    } catch (error: any) {
      logger.warn(`Could not load existing products for idempotent import: ${error.message}`)
    }

    for (const odooProduct of input.products) {
      try {
        const transformed = transformer.transformProduct(
          odooProduct,
          input.import_as_draft
        )

        const productData: any = {
          title: transformed.title,
          subtitle: transformed.subtitle,
          description: transformed.description,
          handle: transformed.handle,
          status: transformed.status,
          is_giftcard: false,
          discountable: true,
          images: transformed.images,
          tags: transformed.tags,
          metadata: transformed.metadata,
          variants: transformed.variants.map((v) => ({
            title: v.title,
            sku: v.sku,
            manage_inventory: v.manage_inventory,
            allow_backorder: v.allow_backorder,
            prices: v.prices,
            options: v.options,
            metadata: v.metadata,
          })),
        }

        const existingId = existingByOdooId.get(String(odooProduct.id))
        if (existingId) {
          await productService.updateProducts(existingId, {
            title: productData.title,
            description: productData.description,
            status: productData.status,
            metadata: productData.metadata,
          })
          result.updated++
          continue
        }

        const [created] = await productService.createProducts([productData])
        createdProductIds.push(created.id)

        try {
          await remoteLink.create({
            [SELLER_MODULE]: { seller_id: input.seller_id },
            [Modules.PRODUCT]: { product_id: created.id },
          })
        } catch (linkError: any) {
          logger.warn(
            `Could not create seller-product link for ${created.id}: ${linkError.message}`
          )
        }

        result.imported++
      } catch (error: any) {
        result.failed++
        result.errors.push({
          product_name: odooProduct.name,
          odoo_product_id: odooProduct.id,
          error: error.message,
        })
        logger.warn(
          `Failed to import Odoo product "${odooProduct.name}" (${odooProduct.id}): ${error.message}`
        )
      }
    }

    return new StepResponse(result, createdProductIds)
  },
  async (createdProductIds, { container }) => {
    if (!createdProductIds || createdProductIds.length === 0) return
    const productService = container.resolve(Modules.PRODUCT)
    try {
      await productService.deleteProducts(createdProductIds)
    } catch {
      // best effort
    }
  }
)

export default transformAndCreateOdooProductsStep
