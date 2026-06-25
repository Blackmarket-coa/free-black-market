import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { createReviewWorkflow } from "@mercurjs/reviews/workflows"
import { createLogger } from "../../../shared/logger"
import { REVIEWS_MODULE } from "../../../modules/reviews"
import type ReviewsService from "../../../modules/reviews/service"
import { sellerReviewSummary } from "../../../modules/reviews/read-helpers"
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
 * Creates a verified-purchase review. The canonical review (rating + comment +
 * product/customer/order links + Algolia indexing) is created via the platform
 * `createReviewWorkflow`; this route then attaches an `embed_review_detail` row
 * for the embed-specific extras (title, public author name, status) and
 * recomputes the seller's denormalized rating/review_count.
 *
 * The platform workflow already verifies order ownership and dedupes one
 * review per (order, product); we additionally require the product to actually
 * be in the order.
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

    // 4) Create the canonical platform review (handles ownership + dedup +
    //    product/customer/order links + Algolia re-index).
    let review: { id: string; created_at?: unknown }
    try {
      const { result } = await createReviewWorkflow.run({
        container: req.scope,
        input: {
          order_id,
          reference: "product",
          reference_id: product_id,
          rating,
          customer_note: body.body?.slice(0, 4000) ?? null,
          customer_id: customerId,
        } as any,
      })
      review = result as any
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (/already exists/i.test(msg)) {
        return res.status(409).json({
          message: "You already reviewed this product for this order",
          type: "conflict",
        })
      }
      throw err
    }

    // 5) Attach the embed-specific detail row (1:1 with the platform review).
    const reviews = req.scope.resolve(REVIEWS_MODULE) as ReviewsService
    const detail = await reviews.createEmbedReviewDetails({
      review_id: review.id,
      seller_id: sellerId,
      product_id,
      title: body.title?.slice(0, 120) ?? null,
      customer_display_name: author,
      is_verified: true,
    })

    // 6) Recompute the seller's denormalized rating/review_count.
    try {
      const aggregate = await sellerReviewSummary(query, reviews, sellerId)
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
        id: review.id,
        product_id,
        rating,
        title: detail.title ?? null,
        body: body.body?.slice(0, 4000) ?? null,
        author: detail.customer_display_name ?? "Verified buyer",
        verified: true,
        created_at: review.created_at ?? detail.created_at,
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
