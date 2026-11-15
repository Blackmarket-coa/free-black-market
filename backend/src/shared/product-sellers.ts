import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

type LinkQuery = {
  graph: (a: Record<string, unknown>) => Promise<{ data: unknown[] }>
}

/**
 * The seller each product belongs to, through Mercur's seller–product link
 * (`seller_product`). It is the link Mercur's split-and-complete-cart reads to
 * put each cart line on its seller's order, and the only record of who owns a
 * product. A product with no link is absent from the map.
 *
 * Product ids are public (every listing and PDP carries them), so anything
 * that attaches a product to a seller's own record — a wellness class or
 * membership tier — must check this link, not trust the id it was sent.
 */
export async function productSellerIds(
  container: MedusaContainer,
  productIds: string[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const ids = [...new Set(productIds.filter((id) => typeof id === "string" && id.length > 0))]
  if (!ids.length) return out
  const query = container.resolve(ContainerRegistrationKeys.QUERY) as LinkQuery
  const { data } = await query.graph({
    entity: "seller_product",
    fields: ["seller_id", "product_id"],
    filters: { product_id: ids },
  })
  for (const row of data as Array<{ seller_id?: unknown; product_id?: unknown }>) {
    if (typeof row?.product_id === "string" && typeof row?.seller_id === "string") {
      out.set(row.product_id, row.seller_id)
    }
  }
  return out
}

/** Whether `productId` is linked to `sellerId` (see {@link productSellerIds}). */
export async function sellerOwnsProduct(
  container: MedusaContainer,
  sellerId: string,
  productId: string
): Promise<boolean> {
  return (await productSellerIds(container, [productId])).get(productId) === sellerId
}
