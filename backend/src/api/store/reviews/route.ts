import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { createLogger } from "../../../shared/logger"
import { REVIEWS_MODULE } from "../../../modules/reviews"
import type ReviewsService from "../../../modules/reviews/service"
import { updateSellerMetadataRecord } from "../../../modules/seller-extension/metadata-service"
import type SellerExtensionService from "../../../modules/seller-extension/service"

const log = createLogger("api/store/reviews")

/** "Jordan Rivera" → "Jordan R."  (privacy-safe public display name) */
function displayName(
  first?: string | null,
  last?: string | null
): string | null {
  const f = (first || "").trim()
  const l = (last || "").trim()
  if (!f && !l) return null
  return l ? `${f} ${l[0]}.`.trim() : f
}

/**
 * POST /store/reviews  (authenticated customer)
 *
 * Creates a verified-purchase review. Accepted ONLY when the referenced order
 * belongs to the authenticated customer and actually contains the product.
 * Recomputes the seller's rating/review_count afterward.
 *
 * Body: { order_id, product_id, rating(1-5), title?, body? }
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const authContext = (req as any).auth_context as
    | { actor_id?: string; actor_type?: string }
    | undefined
  const customerId = authContext?.actor_id
  if (!customerId || !customerId.startsWith("cus_")) {
    return res
      .status(401)
      .json({ message: "Customer authentication required", type: "unauthorized" })
  }

  const body = (req.body ?? {}) as {
    order_id?: string
    product_id?: string
    rating?: number
    title?: string
    body?: string
  }
  const order_id = String(body.order_id || "")
  const product_id = String(body.product_id || "")
  const rating = Math.round(Number(body.rating))

  if (!order_id || !product_id) {
    return res
      .status(400)
      .json({ message: "order_id and product_id are required", type: "invalid_data" })
  }
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return res
      .status(400)
      .json({ message: "rating must be an integer 1-5", type: "invalid_data" })
  }

  try {
    const query = req.scope.resolve("query")

    // 1) The order must belong to this customer and contain the product.
    const { data: orders } = await query.graph({
      entity: "order",
      fields: ["id", "customer_id", "items.product_id"],
      filters: { id: order_id } as any,
    })
    const order = orders?.[0]
    if (!order || order.customer_id !== customerId) {
      return res
        .status(403)
        .json({ message: "Order does not belong to you", type: "not_allowed" })
    }
    const productIds = (order.items || [])
      .map((i: any) => i.product_id)
      .filter(Boolean)
    if (!productIds.includes(product_id)) {
      return res.status(400).json({
        message: "Product was not part of this order",
        type: "invalid_data",
      })
    }

    // 2) Resolve the product's seller for aggregation + scoping.
    const { data: products } = await query.graph({
      entity: "product",
      fields: ["id", "seller.id"],
      filters: { id: product_id } as any,
    })
    const sellerId = (products?.[0] as any)?.seller?.id
    if (!sellerId) {
      return res
        .status(404)
        .json({ message: "Product seller not found", type: "not_found" })
    }

    // 3) Privacy-safe display name from the customer record.
    let author: string | null = null
    try {
      const { data: customers } = await query.graph({
        entity: "customer",
        fields: ["first_name", "last_name"],
        filters: { id: customerId } as any,
      })
      author = displayName(customers?.[0]?.first_name, customers?.[0]?.last_name)
    } catch {
      /* non-fatal */
    }

    const reviews = req.scope.resolve(REVIEWS_MODULE) as ReviewsService

    // Guard the one-review-per-order-product rule before hitting the unique idx.
    const existing = await reviews.listProductReviews(
      { order_id, product_id },
      { take: 1 }
    )
    if (existing?.length) {
      return res.status(409).json({
        message: "You already reviewed this product for this order",
        type: "conflict",
      })
    }

    const created = await reviews.createProductReviews({
      product_id,
      seller_id: sellerId,
      order_id,
      customer_id: customerId,
      rating,
      title: body.title?.slice(0, 120) ?? null,
      body: body.body?.slice(0, 4000) ?? null,
      customer_display_name: author,
      is_verified: true,
    })

    // 4) Recompute the seller's denormalized rating/review_count.
    try {
      const aggregate = await reviews.getSellerAggregate(sellerId)
      const { data: metaRows } = await query.graph({
        entity: "seller_metadata",
        fields: ["id"],
        filters: { seller_id: sellerId } as any,
      })
      const metaId = metaRows?.[0]?.id
      if (metaId) {
        const sellerExtension = req.scope.resolve(
          "sellerExtension"
        ) as SellerExtensionService
        await updateSellerMetadataRecord(sellerExtension, [
          { id: metaId, rating: aggregate.average, review_count: aggregate.count },
        ])
      }
    } catch (err) {
      log.warn(`rating recompute failed for seller ${sellerId}`, err)
    }

    return res.status(201).json({
      review: {
        id: created.id,
        product_id,
        rating,
        title: created.title ?? null,
        body: created.body ?? null,
        author: created.customer_display_name ?? "Verified buyer",
        verified: true,
        created_at: created.created_at,
      },
    })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error"
    log.error("[POST /store/reviews] failed:", msg)
    return res
      .status(500)
      .json({ message: "Failed to submit review", type: "server_error" })
  }
}
