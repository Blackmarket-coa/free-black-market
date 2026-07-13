import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SERVICE_PROGRAM_MODULE } from "../../../../../modules/service-program"
import type ServiceProgramService from "../../../../../modules/service-program/service"

/**
 * GET /store/service-sellers/:sellerId/reviews
 *
 * Public list of reviews for a service provider plus an aggregate rating
 * summary (count + average).
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = req.params.sellerId
  const service = req.scope.resolve<ServiceProgramService>(SERVICE_PROGRAM_MODULE)

  const [reviews, summary] = await Promise.all([
    service.listReviewsForSeller(sellerId),
    service.getSellerRatingSummary(sellerId),
  ])

  return res.status(200).json({
    seller_id: sellerId,
    count: summary.count,
    average_rating: summary.average,
    reviews: (reviews as any[]).map((r) => ({
      id: r.id,
      contract_id: r.contract_id,
      program_id: r.program_id,
      rating: r.rating,
      comment: r.comment,
      created_at: r.created_at,
    })),
  })
}
