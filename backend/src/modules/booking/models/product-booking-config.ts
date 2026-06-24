import { model } from "@medusajs/framework/utils"

/**
 * Product Booking Config
 *
 * Per-product booking parameters for "service"/"bookable" listings. A product
 * with a config (and is_active) is considered bookable; the vendor's weekly
 * `vendor_availability` windows are sliced into slots using these values.
 */
const ProductBookingConfig = model.define("product_booking_config", {
  id: model.id().primaryKey(),

  // The bookable product (1:1) and its owning seller.
  product_id: model.text().unique(),
  seller_id: model.text(),

  // Slot length and gap between slots, in minutes.
  duration_minutes: model.number().default(60),
  buffer_minutes: model.number().default(0),

  // IANA timezone the vendor's availability windows are expressed in.
  timezone: model.text().default("America/New_York"),

  // How far ahead a customer may book, and the minimum lead time.
  advance_days: model.number().default(30),
  min_notice_hours: model.number().default(24),

  is_active: model.boolean().default(true),
})
  .indexes([
    { on: ["seller_id"], name: "IDX_product_booking_config_seller_id" },
    { on: ["product_id"], name: "IDX_product_booking_config_product_id" },
  ])

export default ProductBookingConfig
