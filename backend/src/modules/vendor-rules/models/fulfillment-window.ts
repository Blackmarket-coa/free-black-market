import { model } from "@medusajs/framework/utils"

/**
 * Fulfillment Window
 * 
 * Specific time windows for fulfillment.
 * Vendors can set when they deliver/allow pickup.
 */
const FulfillmentWindow = model.define("fulfillment_window", {
  id: model.id().primaryKey(),
  
  // Link to seller
  seller_id: model.text(),
  
  // Window name (e.g., "Morning Delivery", "Saturday Market")
  name: model.text(),
  
  // Fulfillment type
  fulfillment_type: model.enum(["DELIVERY", "PICKUP", "SHIPPING"]),
  
  // Day of week
  day_of_week: model.number(), // 0-6
  
  // Time window
  start_time: model.text(), // "09:00"
  end_time: model.text(),   // "12:00"
  
  // Capacity (max orders in this window)
  capacity: model.number().default(0), // 0 = unlimited
  
  // Current bookings
  current_bookings: model.number().default(0),
  
  // Lead time (hours before window that orders close)
  cutoff_hours: model.number().default(24),
  
  // Additional fee for this window (cents)
  additional_fee: model.number().default(0),
  
  // Active
  active: model.boolean().default(true),
  
  // Location for pickup windows
  pickup_location: model.text().nullable(),
  pickup_instructions: model.text().nullable(),
  
  // Metadata
  metadata: model.json().nullable(),
})
  .indexes([
    {
      on: ["seller_id"],
      name: "IDX_fw_seller_id",
    },
    {
      on: ["fulfillment_type"],
      name: "IDX_fw_type",
    },
    {
      on: ["day_of_week"],
      name: "IDX_fw_day",
    },
  ])

export default FulfillmentWindow
