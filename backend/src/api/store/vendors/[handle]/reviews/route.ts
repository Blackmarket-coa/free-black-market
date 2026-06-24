import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { createLogger } from "../../../../../shared/logger"
import { REVIEWS_MODULE } from "../../../../../modules/reviews"
import { ReviewStatus } from "../../../../../modules/reviews/models/product-review"
import type ReviewsService from "../../../../../modules/reviews/service"

const log = createLogger("api/store/vendors/reviews")

/**
 * GET /store/vendors/:handle/reviews?limit=&offset=
 *
 * Public, paginated published reviews for a vendor. Exposes only the
 * privacy-safe display name (never email or full name).
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const handle = req.params.handle
  const take = Math.min(Number(req.query.limit) || 20, 100)
  const skip = Number(req.query.offset) || 0

  try {
    const query = req.scope.resolve("query")
    const { data: sellers } = await query.graph({
      entity: "seller",
      fields: ["id"],
      filters: { handle } as any,
    })
    const seller = sellers?.[0]
    if (!seller) {
      return res
        .status(404)
        .json({ message: `No vendor found for handle "${handle}"`, type: "not_found" })
    }

    const reviews = req.scope.resolve(REVIEWS_MODULE) as ReviewsService
    const [rows, count] = await reviews.listAndCountProductReviews(
      { seller_id: seller.id, status: ReviewStatus.PUBLISHED },
      { order: { created_at: "DESC" }, take, skip }
    )
    const aggregate = await reviews.getSellerAggregate(seller.id)

    res.setHeader(
      "Cache-Control",
      "public, max-age=60, s-maxage=300, stale-while-revalidate=600"
    )
    return res.json({
      summary: aggregate,
      reviews: rows.map((r) => ({
        id: r.id,
        product_id: r.product_id,
        rating: r.rating,
        title: r.title ?? null,
        body: r.body ?? null,
        author: r.customer_display_name ?? "Verified buyer",
        verified: !!r.is_verified,
        created_at: r.created_at,
      })),
      count,
      limit: take,
      offset: skip,
    })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error"
    log.error(`[GET vendor reviews] failed for ${handle}:`, msg)
    return res
      .status(500)
      .json({ message: "Failed to load reviews", type: "server_error" })
  }
}
