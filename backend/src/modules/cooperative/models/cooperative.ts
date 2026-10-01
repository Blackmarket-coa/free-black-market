import { model } from "@medusajs/framework/utils"

/**
 * Cooperative Type
 */
export enum CooperativeType {
  FARM_COOP = "FARM_COOP",     // Traditional farmer cooperative
  FOOD_HUB = "FOOD_HUB",       // Aggregation and distribution hub
  CSA = "CSA",                 // Community Supported Agriculture
  BUYING_CLUB = "BUYING_CLUB", // Consumer buying cooperative
  INDIGENOUS = "INDIGENOUS",   // Indigenous agriculture collective
  WORKER_OWNED = "WORKER_OWNED", // Worker-owned cooperative
}

/**
 * Cooperative
 * 
 * Represents a producer group for shared listings,
 * aggregated inventory, and revenue sharing.
 * 
 * Use cases:
 * - Farm cooperatives
 * - Food hubs
 * - Indigenous agriculture collectives
 * - CSA programs
 */
const Cooperative = model.define("cooperative", {
  id: model.id().primaryKey(),
  
  // Basic information
  name: model.text().searchable(),
  handle: model.text().unique(),
  description: model.text().nullable(),
  
  // Type classification
  cooperative_type: model.enum(Object.values(CooperativeType)).default(CooperativeType.FARM_COOP),
  
  // Location
  region: model.text().nullable(),
  state: model.text().nullable(),
  country_code: model.text().nullable(),
  address_line: model.text().nullable(),
  postal_code: model.text().nullable(),
  
  // Contact
  email: model.text().nullable(),
  phone: model.text().nullable(),
  website: model.text().nullable(),
  
  // Branding
  logo: model.text().nullable(),
  cover_image: model.text().nullable(),
  
  // Revenue sharing defaults
  default_platform_commission: model.float().default(0), // Platform's cut
  default_coop_fee: model.float().default(0), // Coop's administrative fee
  
  // Storefront settings
  public_storefront_enabled: model.boolean().default(true),
  featured: model.boolean().default(false),
  
  // Governance
  governance_model: model.text().nullable(), // e.g., "one-member-one-vote"
  membership_requirements: model.text().nullable(),
  
  // Status
  is_active: model.boolean().default(true),
  verified: model.boolean().default(false),
  verified_at: model.dateTime().nullable(),
  
  /**
   * The Blackout coalition this cooperative is the FBM face of, when one
   * exists. An opaque Blackout coalition id — FBM never parses it, it only
   * joins on it, so the two id spaces stay independent.
   */
  blackout_coalition_id: model.text().nullable(),

  /**
   * Joint-drive milestones, pushed by Blackout when a coalition drive closes.
   *
   * Mirrored here rather than queried live so a coalition quest can be
   * evaluated without a synchronous call into Blackout, and so a Blackout
   * outage reads as "no new milestones" rather than "this coalition has done
   * nothing". Counts and cents only — never who gave what.
   */
  coalition_drives_completed: model.number().default(0),
  coalition_drive_raised_cents: model.number().default(0),
  coalition_contributing_members: model.number().default(0),
  coalition_milestones_at: model.dateTime().nullable(),

  // Metadata
  metadata: model.json().nullable(),
})
  .indexes([
    {
      on: ["handle"],
      name: "IDX_cooperative_handle",
    },
    {
      on: ["blackout_coalition_id"],
      name: "IDX_cooperative_blackout_coalition",
    },
    {
      on: ["cooperative_type"],
      name: "IDX_cooperative_type",
    },
    {
      on: ["region"],
      name: "IDX_cooperative_region",
    },
    {
      on: ["public_storefront_enabled"],
      name: "IDX_cooperative_public",
    },
    {
      on: ["is_active"],
      name: "IDX_cooperative_active",
    },
  ])

export default Cooperative
