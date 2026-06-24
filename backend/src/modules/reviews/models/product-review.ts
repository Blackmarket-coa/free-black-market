import { model } from "@medusajs/framework/utils"

export enum ReviewStatus {
  PUBLISHED = "published",
  HIDDEN = "hidden",
}

/**
 * Product Review
 *
 * A verified-purchase review. Tied to the order that proves the purchase via
 * `UNIQUE(order_id, product_id)` so a buyer can leave exactly one review per
 * product per order. `customer_display_name` is the privacy-safe name shown
 * publicly ("Jordan R."); the full customer is referenced by id only.
 */
const ProductReview = model.define("product_review", {
  id: model.id().primaryKey(),

  product_id: model.text(),
  seller_id: model.text(),
  order_id: model.text(),
  customer_id: model.text().nullable(),

  rating: model.number(), // 1-5
  title: model.text().nullable(),
  body: model.text().nullable(),

  customer_display_name: model.text().nullable(),
  is_verified: model.boolean().default(true),

  status: model.enum(Object.values(ReviewStatus)).default(ReviewStatus.PUBLISHED),
})
  .indexes([
    { on: ["product_id"], name: "IDX_product_review_product_id" },
    { on: ["seller_id"], name: "IDX_product_review_seller_id" },
    {
      on: ["order_id", "product_id"],
      name: "UQ_product_review_order_product",
      unique: true,
    },
  ])

export default ProductReview
