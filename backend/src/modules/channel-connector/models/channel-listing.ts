import { model } from "@medusajs/framework/utils"

/**
 * The map between an FBM product and its listing on a channel.
 *
 * The single most important row in this module. Without it, a re-push has no
 * way to know a product is already listed, so it creates a second listing —
 * and a vendor's wholesale catalogue fills with duplicates on the first edit
 * they make. Matching on SKU alone is not enough, because a vendor may change
 * a SKU and because channels do not all treat it as immutable.
 */
const ChannelListing = model
  .define("channel_listing", {
    id: model.id().primaryKey(),

    seller_id: model.text(),
    channel_id: model.text(),
    /** FBM's product id. */
    product_id: model.text(),
    /** The channel's own id for the listing. */
    external_id: model.text(),
    /** SKU at the time of the last push, for diagnosing a mismatch. */
    sku: model.text().nullable(),

    last_pushed_at: model.dateTime().nullable(),
    /** Last rejection from the channel, so the panel can show it per product. */
    last_error: model.text().nullable(),

    metadata: model.json().nullable(),
  })
  .indexes([
    {
      on: ["seller_id", "channel_id", "product_id"],
      unique: true,
      name: "UQ_channel_listing_seller_channel_product",
    },
    { on: ["channel_id", "external_id"], name: "IDX_channel_listing_external" },
  ])

export default ChannelListing
