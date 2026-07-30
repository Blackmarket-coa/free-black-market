import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * GET /store/products/:id/listing-type
 *
 * Minimal read endpoint exposing a product's linked listing-type catalog
 * id (see `src/links/listing-type-product.ts`). The store products API
 * does not expose the link, and the storefront detail page needs it to
 * pick per-type presentation. Returns `{ catalog_id: null }` for a
 * product with no listing-type link so callers can safely default to
 * physical-product presentation.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const query = req.scope.resolve("query")
  const productId = req.params.id

  try {
    const { data: products } = await query.graph({
      entity: "product",
      fields: ["id", "listing_type.catalog_id"],
      filters: {
        id: productId,
      },
    })

    if (!products || products.length === 0) {
      return res.status(404).json({ message: "Product not found" })
    }

    const catalogId = (products[0] as any)?.listing_type?.catalog_id

    res.json({ catalog_id: catalogId ? String(catalogId) : null })
  } catch (error: any) {
    res.status(500).json({
      message: "Failed to fetch listing type",
      error: error.message,
    })
  }
}
