import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { VendorRequest } from "../../types"
import { WOOCOMMERCE_IMPORT_MODULE } from "../../../../modules/woocommerce-import"
import WooCommerceImportModuleService from "../../../../modules/woocommerce-import/service"
import { WooApiClient } from "../../../../modules/woocommerce-import/lib/woo-api-client"
import { decrypt } from "../../../../modules/woocommerce-import/lib/encryption"
import type { ImportPreview } from "../../../../modules/woocommerce-import/types"

/**
 * GET /vendor/woocommerce/preview
 * Preview what products would be imported from the connected WooCommerce store.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as VendorRequest).auth_context?.actor_id

  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized" })
  }

  try {
    const wooService: WooCommerceImportModuleService = req.scope.resolve(
      WOOCOMMERCE_IMPORT_MODULE
    )

    const connections = await wooService.listWooCommerceConnections({
      seller_id: sellerId,
    })

    if (connections.length === 0) {
      return res.status(404).json({
        message: "No WooCommerce connection found. Connect your store first.",
      })
    }

    const conn = connections[0]
    const credentials = {
      url: decrypt(conn.store_url),
      consumer_key: decrypt(conn.consumer_key),
      consumer_secret: decrypt(conn.consumer_secret),
    }

    const client = new WooApiClient(credentials)

    // Fetch products to build preview
    const products = await client.fetchAllProducts()
    const categories = await client.fetchCategories()

    let simpleCount = 0
    let variableCount = 0
    let skippedCount = 0

    for (const product of products) {
      if (product.type === "simple") simpleCount++
      else if (product.type === "variable") variableCount++
      else skippedCount++
    }

    const preview: ImportPreview = {
      total_products: products.length,
      simple_products: simpleCount,
      variable_products: variableCount,
      skipped_products: skippedCount,
      categories,
      store_name: conn.store_name || "Unknown",
      store_url: credentials.url,
      currency: conn.currency || "USD",
    }

    return res.json({ preview })
  } catch (error) {
    return res.status(500).json({
      message: "Failed to preview products",
      error: error.message,
    })
  }
}
