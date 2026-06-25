import { model } from "@medusajs/framework/utils"

export enum ReviewStatus {
  PUBLISHED = "published",
  HIDDEN = "hidden",
}

/**
 * Embed Review Detail
 *
 * A thin companion to the platform `@mercurjs/reviews` `review` model, which is
 * the source of truth for `rating`, `customer_note` (our "body"), and the
 * product/seller/order/customer links. This row holds only the embed-specific
 * extras the platform lacks, keyed 1:1 by `review_id`:
 *   - `title`                 short headline shown in the widget
 *   - `customer_display_name` privacy-safe public name ("Jordan R.")
 *   - `is_verified`           always true today (verified-purchase enforced)
 *   - `status`                published/hidden moderation flag
 *
 * `seller_id`/`product_id` are denormalized here as immutable routing keys: the
 * platform create-review workflow links a product review to product/customer/
 * order but NOT to a seller, and the vendor/product reviews pages aggregate and
 * paginate by these without needing to traverse the platform's links.
 */
const EmbedReviewDetail = model.define("embed_review_detail", {
  id: model.id().primaryKey(),

  review_id: model.text(),
  seller_id: model.text(),
  product_id: model.text(),

  title: model.text().nullable(),
  customer_display_name: model.text().nullable(),
  is_verified: model.boolean().default(true),

  status: model.enum(Object.values(ReviewStatus)).default(ReviewStatus.PUBLISHED),
})
  .indexes([
    {
      on: ["review_id"],
      name: "UQ_embed_review_detail_review_id",
      unique: true,
    },
    { on: ["seller_id"], name: "IDX_embed_review_detail_seller_id" },
    { on: ["product_id"], name: "IDX_embed_review_detail_product_id" },
  ])

export default EmbedReviewDetail
