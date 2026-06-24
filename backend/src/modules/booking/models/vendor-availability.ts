import { model } from "@medusajs/framework/utils"

/**
 * Vendor Availability
 *
 * One recurring weekly window per row, in the vendor's timezone (the timezone
 * lives on product_booking_config). `day_of_week` is 0=Sunday … 6=Saturday;
 * `start_time`/`end_time` are "HH:MM" 24h wall-clock strings. A vendor may have
 * multiple windows per day (e.g. morning + afternoon).
 */
const VendorAvailability = model.define("vendor_availability", {
  id: model.id().primaryKey(),

  seller_id: model.text(),

  day_of_week: model.number(), // 0-6, Sunday-based
  start_time: model.text(), // "HH:MM"
  end_time: model.text(), // "HH:MM"

  is_active: model.boolean().default(true),
})
  .indexes([
    {
      on: ["seller_id", "day_of_week"],
      name: "IDX_vendor_availability_seller_day",
    },
  ])

export default VendorAvailability
