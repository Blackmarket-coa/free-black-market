import { MedusaService } from "@medusajs/framework/utils"
import ProductReview, { ReviewStatus } from "./models/product-review"

export type SellerRatingAggregate = {
  average: number | null
  count: number
}

class ReviewsService extends MedusaService({
  ProductReview,
}) {
  /** Average rating + count of published reviews for a seller. */
  async getSellerAggregate(seller_id: string): Promise<SellerRatingAggregate> {
    const rows = await this.listProductReviews(
      { seller_id, status: ReviewStatus.PUBLISHED },
      { select: ["rating"], take: 100_000 }
    )
    const count = rows.length
    if (!count) return { average: null, count: 0 }
    const sum = rows.reduce((acc, r) => acc + (Number(r.rating) || 0), 0)
    // Round to one decimal place.
    return { average: Math.round((sum / count) * 10) / 10, count }
  }

  /** Average rating + count of published reviews for a single product. */
  async getProductAggregate(
    product_id: string
  ): Promise<SellerRatingAggregate> {
    const rows = await this.listProductReviews(
      { product_id, status: ReviewStatus.PUBLISHED },
      { select: ["rating"], take: 100_000 }
    )
    const count = rows.length
    if (!count) return { average: null, count: 0 }
    const sum = rows.reduce((acc, r) => acc + (Number(r.rating) || 0), 0)
    return { average: Math.round((sum / count) * 10) / 10, count }
  }
}

export default ReviewsService
