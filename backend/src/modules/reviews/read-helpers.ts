import { ReviewStatus } from "./models/embed-review-detail"
import type ReviewsService from "./service"

/**
 * Read-side helpers that merge the two stores into the embed's review shape:
 *   - `embed_review_detail` (this module) → title, author, verified, status,
 *     plus the denormalized seller_id/product_id used for filtering.
 *   - platform `review` (@mercurjs/reviews) → rating, customer_note ("body"),
 *     created_at.
 *
 * Module services are isolated, so the platform `review` rows are fetched here
 * via `query.graph` (the route-layer Query) rather than inside the service.
 */

export type ReviewSummary = { average: number | null; count: number }

export type MergedReview = {
  id: string
  product_id: string
  rating: number
  title: string | null
  body: string | null
  author: string
  verified: boolean
  created_at: unknown
}

type Detail = {
  review_id: string
  product_id: string
  title: string | null
  customer_display_name: string | null
  is_verified: boolean
  created_at?: unknown
}

type PlatformReview = {
  id: string
  rating: number
  customer_note: string | null
  created_at: unknown
}

function summarize(ratings: number[]): ReviewSummary {
  const count = ratings.length
  if (!count) return { average: null, count: 0 }
  const sum = ratings.reduce((acc, r) => acc + (Number(r) || 0), 0)
  // Round to one decimal place.
  return { average: Math.round((sum / count) * 10) / 10, count }
}

/** Fetch platform review rows by id, keyed by id. */
async function fetchPlatformReviews(
  query: any,
  reviewIds: string[]
): Promise<Map<string, PlatformReview>> {
  if (!reviewIds.length) return new Map()
  const { data } = await query.graph({
    entity: "review",
    fields: ["id", "rating", "customer_note", "created_at"],
    filters: { id: reviewIds },
  })
  return new Map((data as PlatformReview[]).map((r) => [r.id, r]))
}

function merge(detail: Detail, review?: PlatformReview): MergedReview {
  return {
    id: detail.review_id,
    product_id: detail.product_id,
    rating: Number(review?.rating ?? 0),
    title: detail.title ?? null,
    body: review?.customer_note ?? null,
    author: detail.customer_display_name ?? "Verified buyer",
    verified: !!detail.is_verified,
    created_at: review?.created_at ?? detail.created_at ?? null,
  }
}

/** Average rating + count of published reviews for a seller or product. */
async function summaryFor(
  query: any,
  reviews: ReviewsService,
  filter: { seller_id: string } | { product_id: string }
): Promise<ReviewSummary> {
  const details = (await reviews.listEmbedReviewDetails(
    { ...filter, status: ReviewStatus.PUBLISHED },
    { select: ["review_id"], take: 100_000 }
  )) as Detail[]
  const reviewMap = await fetchPlatformReviews(
    query,
    details.map((d) => d.review_id)
  )
  return summarize(
    details
      .map((d) => reviewMap.get(d.review_id)?.rating)
      .filter((r): r is number => typeof r === "number")
  )
}

/** Paginated published reviews for a seller or product, merged + ordered. */
async function listFor(
  query: any,
  reviews: ReviewsService,
  filter: { seller_id: string } | { product_id: string },
  { take, skip }: { take: number; skip: number }
): Promise<{ rows: MergedReview[]; count: number }> {
  const [details, count] = (await reviews.listAndCountEmbedReviewDetails(
    { ...filter, status: ReviewStatus.PUBLISHED },
    { order: { created_at: "DESC" }, take, skip }
  )) as [Detail[], number]
  const reviewMap = await fetchPlatformReviews(
    query,
    details.map((d) => d.review_id)
  )
  return {
    rows: details.map((d) => merge(d, reviewMap.get(d.review_id))),
    count,
  }
}

export const sellerReviewSummary = (
  query: any,
  reviews: ReviewsService,
  seller_id: string
) => summaryFor(query, reviews, { seller_id })

export const productReviewSummary = (
  query: any,
  reviews: ReviewsService,
  product_id: string
) => summaryFor(query, reviews, { product_id })

export const listSellerReviews = (
  query: any,
  reviews: ReviewsService,
  seller_id: string,
  page: { take: number; skip: number }
) => listFor(query, reviews, { seller_id }, page)

export const listProductReviews = (
  query: any,
  reviews: ReviewsService,
  product_id: string,
  page: { take: number; skip: number }
) => listFor(query, reviews, { product_id }, page)
