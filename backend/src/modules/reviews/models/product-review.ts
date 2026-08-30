import { model } from "@medusajs/framework/utils"

export enum ReviewStatus {
  PUBLISHED = "published",
  HIDDEN = "hidden",
}

/**
 * What a review is about (W4 reviews dedupe — decision D7's "one reviews
 * module"):
 *
 *   - `product`          — verified purchase review of a product (original).
 *   - `seller`           — order-verified review of the seller (the shape
 *                          the storefront's ReviewForm submits).
 *   - `service_contract` — a client reviewing a service provider after an
 *                          accepted contract (absorbed from the
 *                          service-program module; rows copied by
 *                          Migration20260830ReviewsAbsorption).
 */
export enum ReviewSubjectType {
  PRODUCT = "product",
  SELLER = "seller",
  SERVICE_CONTRACT = "service_contract",
}

/**
 * Review (historically "Product Review" — table name kept for continuity).
 *
 * The marketplace's ONE review store. Product reviews are tied to the order
 * that proves the purchase via `UNIQUE(order_id, product_id)` (one review per
 * product per order); seller reviews are unique per
 * `(order_id, seller_id)` and service reviews per
 * `(contract_id, reviewer_seller_id)` (partial unique indexes added by the
 * absorption migration). `customer_display_name` is the privacy-safe name
 * shown publicly ("Jordan R."); the full customer is referenced by id only.
 */
const ProductReview = model.define("embed_product_review", {
  id: model.id().primaryKey(),

  subject_type: model
    .enum(Object.values(ReviewSubjectType))
    .default(ReviewSubjectType.PRODUCT),

  /** Set for `product` reviews; null for seller/service subjects. */
  product_id: model.text().nullable(),
  /** The reviewed party (product's seller, the seller itself, or the service provider). */
  seller_id: model.text(),
  /** Purchase proof for product/seller subjects; null for service reviews. */
  order_id: model.text().nullable(),
  customer_id: model.text().nullable(),

  /** Service-contract subject fields (absorbed from service-program). */
  contract_id: model.text().nullable(),
  program_id: model.text().nullable(),
  /** Author when the reviewer is a seller (service contracts' client). */
  reviewer_seller_id: model.text().nullable(),

  rating: model.number(), // 1-5
  title: model.text().nullable(),
  body: model.text().nullable(),

  customer_display_name: model.text().nullable(),
  is_verified: model.boolean().default(true),

  status: model.enum(Object.values(ReviewStatus)).default(ReviewStatus.PUBLISHED),

  metadata: model.json().nullable(),
})
  .indexes([
    { on: ["product_id"], name: "IDX_embed_product_review_product_id" },
    { on: ["seller_id"], name: "IDX_embed_product_review_seller_id" },
    {
      on: ["order_id", "product_id"],
      name: "UQ_embed_product_review_order_product",
      unique: true,
    },
  ])

export default ProductReview
