import { MedusaService } from "@medusajs/framework/utils"
import ProductReview, {
  ReviewStatus,
  ReviewSubjectType,
} from "./models/product-review"

export type SellerRatingAggregate = {
  average: number | null
  count: number
}

/**
 * Marketplace-facing subjects: what buyers say about a seller's products and
 * about the seller. Service-contract reviews (vendor↔vendor, absorbed from
 * service-program in W4) aggregate separately — see
 * `getServiceSellerAggregate` — so the two rating scales never blend.
 */
const MARKETPLACE_SUBJECTS = [
  ReviewSubjectType.PRODUCT,
  ReviewSubjectType.SELLER,
]

class ReviewsService extends MedusaService({
  ProductReview,
}) {
  /** Average rating + count of published marketplace reviews for a seller. */
  async getSellerAggregate(seller_id: string): Promise<SellerRatingAggregate> {
    const rows = await this.listProductReviews(
      {
        seller_id,
        status: ReviewStatus.PUBLISHED,
        subject_type: MARKETPLACE_SUBJECTS,
      },
      { select: ["rating"], take: 100_000 }
    )
    const count = rows.length
    if (!count) return { average: null, count: 0 }
    const sum = rows.reduce((acc, r) => acc + (Number(r.rating) || 0), 0)
    // Round to one decimal place.
    return { average: Math.round((sum / count) * 10) / 10, count }
  }

  /**
   * Average rating + count for a SERVICE PROVIDER (service-contract
   * reviews). Keeps the service-program contract's 2-decimal rounding and
   * `average: 0` empty-state so the re-pointed route stays byte-compatible.
   */
  async getServiceSellerAggregate(
    service_seller_id: string
  ): Promise<{ average: number; count: number }> {
    const rows = await this.listProductReviews(
      {
        seller_id: service_seller_id,
        status: ReviewStatus.PUBLISHED,
        subject_type: ReviewSubjectType.SERVICE_CONTRACT,
      },
      { select: ["rating"], take: 100_000 }
    )
    const count = rows.length
    if (!count) return { average: 0, count: 0 }
    const sum = rows.reduce((acc, r) => acc + (Number(r.rating) || 0), 0)
    return { average: Math.round((sum / count) * 100) / 100, count }
  }

  /**
   * Average rating + count of published reviews for many sellers at once.
   *
   * Same aggregate as `getSellerAggregate`, in one query instead of N. List
   * endpoints that render a rating per row (the creator marketplace listings)
   * would otherwise either issue a query per row or fall back to the
   * `seller_metadata.review_count` column, which nothing writes.
   *
   * Sellers with no published reviews are present in the map with
   * `{ average: null, count: 0 }`, so callers can read the result without
   * having to distinguish "no reviews" from "not looked up".
   */
  async getSellerAggregates(
    seller_ids: string[]
  ): Promise<Map<string, SellerRatingAggregate>> {
    const unique = [...new Set(seller_ids.filter(Boolean))]
    const result = new Map<string, SellerRatingAggregate>(
      unique.map((id) => [id, { average: null, count: 0 }])
    )
    if (!unique.length) return result

    const rows = await this.listProductReviews(
      {
        seller_id: unique,
        status: ReviewStatus.PUBLISHED,
        subject_type: MARKETPLACE_SUBJECTS,
      },
      { select: ["seller_id", "rating"], take: 100_000 }
    )

    const totals = new Map<string, { sum: number; count: number }>()
    for (const row of rows) {
      const key = String(row.seller_id)
      const bucket = totals.get(key) ?? { sum: 0, count: 0 }
      bucket.sum += Number(row.rating) || 0
      bucket.count += 1
      totals.set(key, bucket)
    }

    for (const [id, { sum, count }] of totals) {
      result.set(id, {
        average: Math.round((sum / count) * 10) / 10,
        count,
      })
    }

    return result
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
