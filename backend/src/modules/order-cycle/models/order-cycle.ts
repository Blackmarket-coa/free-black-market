import { model } from "@medusajs/framework/utils"

/**
 * Order Cycle - Core model for food commerce
 *
 * An Order Cycle represents a time-bounded ordering window where:
 * - Customers can place orders during open period
 * - Vendors prepare products for dispatch date
 * - Orders are grouped for efficient fulfillment (e.g., weekly pickup)
 *
 * This is modeled after Open Food Network's Order Cycle concept.
 */
const OrderCycle = model.define("order_cycle", {
  id: model.id().primaryKey(),
  
  // Basic info
  name: model.text().searchable(),
  description: model.text().nullable(),
  
  // Timing - the core of order cycles
  opens_at: model.dateTime(),      // When ordering opens
  closes_at: model.dateTime(),     // When ordering closes
  dispatch_at: model.dateTime(),   // When orders are fulfilled/dispatched
  
  // Status derived from timing but can be manually controlled
  status: model.enum([
    "draft",       // Being configured
    "upcoming",    // Scheduled but not yet open
    "open",        // Currently accepting orders
    "closed",      // No longer accepting orders, awaiting dispatch
    "dispatched",  // Orders have been fulfilled
    "cancelled"    // Cancelled by admin
  ]).default("draft"),
  
  // Coordinator - the seller who manages this order cycle
  coordinator_seller_id: model.text(),
  
  // Configuration
  is_recurring: model.boolean().default(false),
  recurrence_rule: model.text().nullable(), // iCal RRULE format for recurring cycles
  
  // Pickup/delivery info (default for the cycle)
  pickup_instructions: model.text().nullable(),
  pickup_location: model.text().nullable(),
  
  // "Ready for" text shown to customers
  ready_for_text: model.text().nullable(),
  
  /**
   * The Blackout coalition whose members share this ordering window, and the
   * coalition campaign that opened it.
   *
   * A coalition's shared batch-ordering window is an ordinary order cycle —
   * same open/close/dispatch timing, same exchanges, same fees. These two
   * columns record where it came from so Blackout can find the window it
   * opened and so a coalition view can list its own cycles; nothing in the
   * order-cycle engine branches on them.
   */
  blackout_coalition_id: model.text().nullable(),
  blackout_campaign_id: model.text().nullable(),

  // Metadata for extensions
  metadata: model.json().nullable(),
})
.indexes([
  {
    name: "IDX_ORDER_CYCLE_STATUS",
    on: ["status"],
  },
  {
    name: "IDX_ORDER_CYCLE_OPENS_AT",
    on: ["opens_at"],
  },
  {
    name: "IDX_ORDER_CYCLE_CLOSES_AT",
    on: ["closes_at"],
  },
  {
    name: "IDX_ORDER_CYCLE_COORDINATOR",
    on: ["coordinator_seller_id"],
  },
  {
    name: "IDX_ORDER_CYCLE_COALITION",
    on: ["blackout_coalition_id"],
  },
  {
    name: "IDX_ORDER_CYCLE_CAMPAIGN",
    on: ["blackout_campaign_id"],
    unique: true,
  },
])

export default OrderCycle
