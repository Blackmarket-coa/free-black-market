import { model } from "@medusajs/framework/utils"

/**
 * Member — an active membership held by a client. Billing cadence/dunning lives
 * in the `subscription` module (linked via `subscription_id`); this row tracks
 * tier, status, and the per-period session-credit ledger.
 *
 * Note the table is prefixed `wellness_member` because the MercurJS platform
 * already owns a `member` table.
 *
 * SCOPED to `seller_id`; one membership per (seller_id, email).
 */
export type MemberStatus = "active" | "paused" | "past_due" | "cancelled" | "expired"

const Member = model.define("wellness_member", {
  id: model.id().primaryKey(),

  seller_id: model.text(),
  membership_tier_id: model.text(),

  customer_id: model.text().nullable(),
  email: model.text(),
  name: model.text().nullable(),

  // Link to the recurring billing record in the subscription module.
  subscription_id: model.text().nullable(),

  // "active" | "paused" | "past_due" | "cancelled" | "expired"
  status: model.text().default("active"),

  // Session-credit ledger for the current period.
  credits_balance: model.number().default(0),
  credits_used_this_period: model.number().default(0),
  credits_allocated_total: model.number().default(0),

  joined_at: model.dateTime().nullable(),
  current_period_end: model.dateTime().nullable(),
  cancelled_at: model.dateTime().nullable(),

  // Lifetime value in the smallest currency unit (cents).
  ltv_amount: model.number().default(0),

  blackout_room_invited: model.boolean().default(false),
  metadata: model.json().nullable(),
})
  .indexes([
    { on: ["seller_id"], name: "IDX_wellness_member_seller_id" },
    { on: ["subscription_id"], name: "IDX_wellness_member_subscription_id" },
    {
      on: ["seller_id", "email"],
      name: "UQ_wellness_member_seller_email",
      unique: true,
    },
  ])

export default Member
