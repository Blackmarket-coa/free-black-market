import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import PrintfulClient from "../../../../modules/printful-fulfillment/client"
import { getPrintfulApiKey, getPrintfulStoreId } from "../../../../modules/printful-fulfillment/env"
import { getSellerId } from "../../quests/_helpers"

type PrintfulImportBody = {
  product_ids?: Array<number | string>
  import_as_draft?: boolean
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  // The store, not the actor: behind the vendor gate the actor is a member
  // id, and products linked to it belonged to no store (SD-145).
  const sellerId = await getSellerId(req)

  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized" })
  }

  const apiKey = getPrintfulApiKey()
  if (!apiKey) {
    return res.status(400).json({
      message: "PRINTFUL_API_KEY is not configured on the backend.",
    })
  }

  const body = (req.body || {}) as PrintfulImportBody
  const productIds = Array.isArray(body.product_ids)
    ? body.product_ids.map((id) => Number(id)).filter((id) => Number.isFinite(id))
    : []

  if (!productIds.length) {
    return res.status(400).json({ message: "product_ids is required" })
  }

  const importAsDraft = body.import_as_draft ?? true

  try {
    const client = new PrintfulClient({
      apiKey,
      storeId: getPrintfulStoreId(),
    })

    const productService = req.scope.resolve<any>(Modules.PRODUCT)
    const remoteLink = req.scope.resolve(ContainerRegistrationKeys.REMOTE_LINK)

    const catalogProducts = await Promise.all(productIds.map((id) => client.getCatalogProduct(id)))

    const toCreate = catalogProducts
      .filter((p: any) => p && p.id)
      .map((product: any) => {
        const fallbackVariantId = Number(product.variants?.[0]?.id || 0)

        return {
          title: product.title || product.name || `Printful Product ${product.id}`,
          subtitle: product.brand || undefined,
          description: product.description || `Imported from Printful catalog (${product.id}).`,
          handle: `printful-${String(product.id)}`,
          status: importAsDraft ? "draft" : "published",
          options: [{ title: "Size", values: ["Default"] }],
          variants: [
            {
              title: "Default",
              sku: product.id ? `printful-${product.id}` : undefined,
              manage_inventory: false,
              allow_backorder: true,
              options: { Size: "Default" },
              prices: [],
              metadata: {
                printful_variant_id: fallbackVariantId || undefined,
                printful_product_id: product.id,
              },
            },
          ],
          thumbnail: product.image || product.thumbnail_url || undefined,
          metadata: {
            printful_product_id: product.id,
            printful_synced_at: new Date().toISOString(),
          },
        }
      })

    const created = [] as any[]

    for (const productData of toCreate) {
      const [createdProduct] = await productService.createProducts([productData])
      created.push(createdProduct)

      try {
        await remoteLink.create({
          seller: { seller_id: sellerId },
          product: { product_id: createdProduct.id },
        })
      } catch {
        // best effort link creation
      }
    }

    return res.status(200).json({
      result: {
        imported: created.length,
        failed: productIds.length - created.length,
        skipped: 0,
      },
      products: created.map((p) => ({ id: p.id, title: p.title })),
    })
  } catch (error: any) {
    return res.status(500).json({
      message: "Failed to import Printful products",
      error: error.message,
    })
  }
}
