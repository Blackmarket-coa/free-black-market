import { model } from "@medusajs/framework/utils"

/**
 * Product Archetype Enum
 * 
 * Defines the behavioral category of a product.
 * Each archetype controls:
 * - Inventory strategy
 * - Availability rules  
 * - Fulfillment methods
 * - Refundability
 * - Tax treatment
 */
export enum ProductArchetypeCode {
  // Agricultural products
  AGRICULTURAL_RAW = "AGRICULTURAL_RAW",           // Fresh produce, raw meat, dairy
  AGRICULTURAL_PROCESSED = "AGRICULTURAL_PROCESSED", // Jams, pickles, canned goods

  // Restaurant/prepared food
  RESTAURANT_PREPARED = "RESTAURANT_PREPARED",     // Ready-to-eat meals

  // Standard retail / tools / infrastructure
  NON_PERISHABLE = "NON_PERISHABLE",              // Shelf-stable goods, tools, equipment

  // Digital products
  DIGITAL = "DIGITAL",                             // Downloads, licenses, network access

  // Tickets and events
  TICKET = "TICKET",                               // Event tickets, venue access

  // Subscriptions
  SUBSCRIPTION = "SUBSCRIPTION",                   // Recurring delivery, CSA shares

  // Community / Mutual Aid archetypes (no drop-shipping)
  LAND_ACCESS = "LAND_ACCESS",                     // Garden plots, farm plots — reservation-based, no inventory
  MUTUAL_AID = "MUTUAL_AID",                       // Care kits, essentials — community-funded, manual fulfillment
  CIRCULAR_ECONOMY = "CIRCULAR_ECONOMY",           // Repaired goods, salvaged materials — condition-graded
  COMMUNITY_SERVICE = "COMMUNITY_SERVICE",         // Shared spaces, skill shares — capacity-based
  EXPERIMENTAL = "EXPERIMENTAL",                   // Prototypes, pilot projects — requires governance approval

  // Marketplace-layer archetypes for the BMC ecosystem
  SERVICE = "SERVICE",                             // Generic vendor services (consulting, coaching, design)
  PLUGIN = "PLUGIN",                               // Software plugin distributed via the marketplace
  THEME = "THEME",                                 // Storefront/UI theme
  EMOJI_PACK = "EMOJI_PACK",                       // Custom emoji packs (e.g. for Blackout)
  ACCESS_PASS = "ACCESS_PASS",                     // Time-bound or perpetual feature access (entitlement-driven)
}

/**
 * Inventory Strategy
 */
export enum InventoryStrategy {
  STANDARD = "STANDARD",           // Normal SKU-based inventory
  LOT_BASED = "LOT_BASED",         // Agricultural lot/batch tracking
  UNLIMITED = "UNLIMITED",          // Digital products
  CAPACITY = "CAPACITY",            // Tickets with seat/capacity limits
  NONE = "NONE",                    // On-demand, made-to-order
}

/**
 * Product Archetype Definition
 * 
 * Declares the behavioral rules for a product category.
 */
const ProductArchetype = model.define("product_archetype", {
  id: model.id().primaryKey(),
  
  // Archetype identifier
  code: model.enum(Object.values(ProductArchetypeCode)).unique(),
  
  // Human-readable name
  name: model.text(),
  description: model.text().nullable(),
  
  // Inventory behavior
  inventory_strategy: model.enum(Object.values(InventoryStrategy)).default(InventoryStrategy.STANDARD),
  
  // Availability rules
  requires_availability_window: model.boolean().default(false),
  supports_preorder: model.boolean().default(false),
  perishable: model.boolean().default(false),
  perishable_shelf_days: model.number().nullable(),
  
  // Fulfillment rules
  requires_shipping: model.boolean().default(true),
  supports_pickup: model.boolean().default(true),
  supports_delivery: model.boolean().default(true),
  fulfillment_lead_time_hours: model.number().nullable(),
  
  // Returns and refunds
  refundable: model.boolean().default(true),
  return_window_days: model.number().nullable(),
  
  // Tax treatment
  tax_category: model.text().nullable(), // Links to tax provider categories
  
  // Feature flags
  requires_lot_tracking: model.boolean().default(false),
  supports_surplus_pricing: model.boolean().default(false),
  requires_producer_link: model.boolean().default(false),
  
  // Metadata for extensions
  metadata: model.json().nullable(),
})

export default ProductArchetype
