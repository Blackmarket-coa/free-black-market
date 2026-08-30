import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { REVIEWS_MODULE } from "../../../../../modules/reviews"
import type ReviewsService from "../../../../../modules/reviews/service"
import { ReviewSubjectType } from "../../../../../modules/reviews/models/product-review"

/**
 * GET /store/service-sellers/:sellerId/reviews
 *
 * Public list of reviews for a service provider plus an aggregate rating
 * summary (count + average). W4: served from the consolidated reviews
 * module (subject_type = service_contract — rows absorbed from the
 * service-program implementation); response shape unchanged, including the
 * 2-decimal average and `comment` field name.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = req.params.sellerId
  const reviews = req.scope.resolve<ReviewsService>(REVIEWS_MODULE)

  const [rows, summary] = await Promise.all([
    reviews.listProductReviews(
      {
        seller_id: sellerId,
        subject_type: ReviewSubjectType.SERVICE_CONTRACT,
      },
      { take: 1000, order: { created_at: "DESC" } }
    ),
    reviews.getServiceSellerAggregate(sellerId),
  ])

  return res.status(200).json({
    seller_id: sellerId,
    count: summary.count,
    average_rating: summary.average,
    reviews: rows.map((r) => ({
      id: r.id,
      contract_id: r.contract_id,
      program_id: r.program_id,
      rating: Number(r.rating),
      comment: r.body ?? null,
      created_at: r.created_at,
    })),
  })
}
