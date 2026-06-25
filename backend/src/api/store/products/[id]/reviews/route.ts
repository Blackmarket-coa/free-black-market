import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { createLogger } from "../../../../../shared/logger"
import { REVIEWS_MODULE } from "../../../../../modules/reviews"
import type ReviewsService from "../../../../../modules/reviews/service"
import {
  listProductReviews,
  productReviewSummary,
} from "../../../../../modules/reviews/read-helpers"

const log = createLogger("api/store/products/reviews")

/**
 * GET /store/products/:id/reviews?limit=&offset=
 *
 * Public, paginated published reviews for a single product. Rating/comment come
 * from the platform `review`; title/author/verified from `embed_review_detail`.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const productId = req.params.id
  const take = Math.min(Number(req.query.limit) || 20, 100)
  const skip = Number(req.query.offset) || 0

  try {
    const query = req.scope.resolve("query")
    const reviews = req.scope.resolve(REVIEWS_MODULE) as ReviewsService
    const { rows, count } = await listProductReviews(query, reviews, productId, {
      take,
      skip,
    })
    const summary = await productReviewSummary(query, reviews, productId)

    res.setHeader(
      "Cache-Control",
      "public, max-age=60, s-maxage=300, stale-while-revalidate=600"
    )
    return res.json({
      summary,
      reviews: rows.map((r) => ({
        id: r.id,
        rating: r.rating,
        title: r.title,
        body: r.body,
        author: r.author,
        verified: r.verified,
        created_at: r.created_at,
      })),
      count,
      limit: take,
      offset: skip,
    })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error"
    log.error(`[GET product reviews] failed for ${productId}:`, msg)
    return res
      .status(500)
      .json({ message: "Failed to load reviews", type: "server_error" })
  }
}
