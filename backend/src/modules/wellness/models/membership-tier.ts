import { model } from "@medusajs/framework/utils"

/**
 * Membership Tier — a subscription tier definition (Seed / Root / Bloom /
 * Sovereign). Recurring billing itself is handled by the `subscription` module;
 * this row holds the tier's price, perks, and the per-period session-credit
 * allowance that subscriptions don't model.
 */
export type MembershipInterval = "monthly" | "yearly"

const MembershipTier = model.define("wellness_membership_tier", {
  id: model.id().primaryKey(),

  seller_id: model.text(),
  product_id: model.text().nullable(),

  name: model.text(),
  description: model.text().nullable(),

  // Price in the smallest currency unit (cents).
  price_amount: model.number().default(0),
  currency_code: model.text().default("usd"),
  // "monthly" | "yearly"
  interval: model.text().default("monthly"),

  // Session credits granted each billing period.
  credits_per_period: model.number().default(0),
  // Whether unused credits roll over (vs. expire at period end).
  credits_roll_over: model.boolean().default(false),

  // Discount applied to sessions/products for members of this tier (0–100).
  discount_pct: model.number().default(0),

  // Free-form perks list (Array<string>) + the Blackout room(s) unlocked.
  perks: model.json().nullable(),
  blackout_room_alias: model.text().nullable(),

  is_active: model.boolean().default(true),
  display_order: model.number().default(0),

  metadata: model.json().nullable(),
})
  .indexes([
    { on: ["seller_id"], name: "IDX_wellness_membership_tier_seller_id" },
  ])

export default MembershipTier
