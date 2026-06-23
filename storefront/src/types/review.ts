/**
 * Shared review shapes for the marketplace review endpoints.
 *
 * Seller-attached reviews (the `*seller.reviews` relation) reuse the richer
 * `SingleProductReview` shape in `./product`; the order-attached reviews
 * returned on `/store/orders` and `/store/reviews` are a narrower record, and
 * the create endpoint takes a fixed payload.
 */

/**
 * Review element as returned on the `/store/orders` and `/store/reviews`
 * `*reviews` relation (the review a customer wrote against an order).
 */
export type OrderReview = {
  id: string
  rating: number
  customer_note: string
  created_at: string
  updated_at?: string
}

/** Payload accepted by `POST /store/reviews`. */
export type CreateReviewPayload = {
  order_id: string
  rating: number
  reference: string
  reference_id: string
  customer_note: string
}
