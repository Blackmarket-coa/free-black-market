import { model } from "@medusajs/framework/utils"

/**
 * Sales Channel for Availability
 */
export enum SalesChannel {
  DTC = "DTC",             // Direct to Consumer (storefront)
  B2B = "B2B",             // Business to Business (restaurants, retailers)
  CSA = "CSA",             // Community Supported Agriculture shares
  WHOLESALE = "WHOLESALE", // Bulk wholesale
  FARMERS_MARKET = "FARMERS_MARKET", // In-person market sales
}

/**
 * Pricing Strategy
 */
export enum PricingStrategy {
  FIXED = "FIXED",         // Fixed price per unit
  TIERED = "TIERED",       // Volume-based tiers
  DYNAMIC = "DYNAMIC",     // Price varies based on demand/availability
  AUCTION = "AUCTION",     // Bidding (future feature)
  NEGOTIATED = "NEGOTIATED", // Price negotiated with buyer
}

/**
 * Availability Window
 * 
 * Defines WHEN and HOW lots can be purchased.
 * This is the bridge between agricultural lots and sellable products.
 * 
 * Key features:
 * - Time-bound availability (seasonal, pre-harvest, limited windows)
 * - Channel-specific pricing
 * - Preorder support
 * - Integration with Medusa products
 */
const AvailabilityWindow = model.define("availability_window", {
  id: model.id().primaryKey(),
  
  // Link to lot (source of inventory)
  lot_id: model.text(),
  
  // Link to Medusa product (for storefront display)
  product_id: model.text().nullable(),
  
  // Availability timing
  available_from: model.dateTime(),
  available_until: model.dateTime().nullable(), // Null = open-ended
  
  // Sales channel
  sales_channel: model.enum(Object.values(SalesChannel)).default(SalesChannel.DTC),
  
  // Pricing (FARMER-CONTROLLED)
  pricing_strategy: model.enum(Object.values(PricingStrategy)).default(PricingStrategy.FIXED),
  unit_price: model.float(), // Price per unit
  currency_code: model.text().default("usd"),
  
  // Volume pricing tiers (for TIERED strategy)
  // Array of { min_quantity: number, max_quantity?: number, price_per_unit: number }
  price_tiers: model.json().nullable(),
  
  // Quantity limits
  min_order_quantity: model.float().nullable(),
  max_order_quantity: model.float().nullable(),
  quantity_increment: model.float().nullable(), // e.g., must order in multiples of 0.5
  
  // Preorder settings
  preorder_enabled: model.boolean().default(false),
  preorder_deposit_percent: model.float().nullable(), // e.g., 25% deposit
  estimated_ship_date: model.dateTime().nullable(),
  
  // Fulfillment options
  pickup_enabled: model.boolean().default(true),
  delivery_enabled: model.boolean().default(true),
  shipping_enabled: model.boolean().default(false), // Standard carrier shipping
  
  // Pickup locations (JSON array of location objects)
  pickup_locations: model.json().nullable(),
  
  // Lead time
  fulfillment_lead_time_hours: model.number().nullable(),
  
  // Surplus pricing (when lot has surplus_flag)
  surplus_discount_percent: model.float().nullable(),
  
  // Display settings
  featured: model.boolean().default(false),
  sort_order: model.number().default(0),
  
  // Status
  is_active: model.boolean().default(true),
  paused_at: model.dateTime().nullable(), // Temporarily paused
  pause_reason: model.text().nullable(),
  
  // No analytics counters here. `view_count` and `order_count` were declared
  // and defaulted to 0, but nothing ever incremented them and nothing ever read
  // them (C2) — a field that always reads zero is worse than an absent one,
  // because it looks like data. Removed from the model; the columns remain in
  // the table (see Migration20251228CreateAgriculture) and can be dropped
  // whenever the next agriculture migration runs. If window-level analytics are
  // wanted later, derive them from orders rather than reviving a counter that
  // nothing maintains.

  // Metadata
  metadata: model.json().nullable(),
})
  .indexes([
    {
      on: ["lot_id"],
      name: "IDX_availability_lot",
    },
    {
      on: ["product_id"],
      name: "IDX_availability_product",
    },
    {
      on: ["sales_channel"],
      name: "IDX_availability_channel",
    },
    {
      on: ["available_from"],
      name: "IDX_availability_from",
    },
    {
      on: ["available_until"],
      name: "IDX_availability_until",
    },
    {
      on: ["is_active"],
      name: "IDX_availability_active",
    },
    {
      on: ["preorder_enabled"],
      name: "IDX_availability_preorder",
    },
    {
      on: ["featured"],
      name: "IDX_availability_featured",
    },
  ])

export default AvailabilityWindow
