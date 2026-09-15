import { model } from "@medusajs/framework/utils"

/**
 * Member Role in Cooperative
 */
export enum CooperativeMemberRole {
  ADMIN = "ADMIN",         // Full administrative access
  COORDINATOR = "COORDINATOR", // Can manage listings and orders
  PRODUCER = "PRODUCER",   // Can contribute products
  MEMBER = "MEMBER",       // Basic member, can view
}

/**
 * Cooperative Member
 * 
 * Links producers to cooperatives with revenue sharing rules.
 * A producer can belong to multiple cooperatives.
 */
const CooperativeMember = model.define("cooperative_member", {
  id: model.id().primaryKey(),
  
  // Links
  cooperative_id: model.text(),
  producer_id: model.text(),
  /**
   * The MercurJS seller this member sells as, when they have a shop.
   *
   * `producer_id` is written with a customer actor id on the store join path
   * and a producer row id on the seller launch path, so it cannot be used to
   * resolve a catalog. A collective storefront needs seller ids, so it reads
   * this column and ignores `producer_id` entirely.
   */
  seller_id: model.text().nullable(),
  
  // Role
  role: model.enum(Object.values(CooperativeMemberRole)).default(CooperativeMemberRole.PRODUCER),
  
  // Revenue sharing (override cooperative defaults)
  revenue_share_percent: model.float().nullable(), // Producer's share of sales
  
  // Membership
  joined_at: model.dateTime(),
  membership_number: model.text().nullable(),
  
  // Contribution limits
  max_products: model.number().nullable(), // Max products this member can list
  max_monthly_revenue: model.float().nullable(), // Revenue cap
  
  // Status
  is_active: model.boolean().default(true),
  suspended_at: model.dateTime().nullable(),
  suspension_reason: model.text().nullable(),
  
  // Metadata
  metadata: model.json().nullable(),
})
  .indexes([
    {
      on: ["cooperative_id"],
      name: "IDX_coop_member_cooperative",
    },
    {
      on: ["producer_id"],
      name: "IDX_coop_member_producer",
    },
    {
      on: ["role"],
      name: "IDX_coop_member_role",
    },
    {
      on: ["is_active"],
      name: "IDX_coop_member_active",
    },
  ])

export default CooperativeMember
