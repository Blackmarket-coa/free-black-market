import { model } from "@medusajs/framework/utils"

/**
 * XP Redemption
 *
 * Append-only ledger of spendable-XP redemptions. Complements `xp_event`
 * (which records *earning*) by recording every *spend*: when a customer trades
 * spendable XP for a reward, a row is written here and `character_sheet.
 * spendable_xp` is decremented. Lifetime `total_xp` is never touched — status
 * and balance are deliberately separate ("dual balance").
 *
 * Lifecycle: a redemption is created `pending`, marked `fulfilled` once the
 * reward is granted, or `refunded` (with the XP credited back) if granting
 * fails. This mirrors the volunteer module's earn→redeem audit pattern.
 */

export enum XpRedemptionStatus {
  PENDING = "pending",
  FULFILLED = "fulfilled",
  REFUNDED = "refunded",
}

/** What a redemption grants. */
export enum XpRewardKind {
  // An entitlement perk (theme, emoji pack, access pass, featured slot, …).
  ENTITLEMENT = "entitlement",
  // A digital-product download, unlocked via an entitlement of kind=digital.
  DIGITAL_DOWNLOAD = "digital_download",
}

const XpRedemption = model.define("xp_redemption", {
  id: model.id().primaryKey(),

  customer_id: model.text(),

  // Catalog key of the redeemed reward (see rewards.ts).
  reward_key: model.text(),
  // Human-readable snapshot of the reward name at redemption time.
  reward_name: model.text(),
  reward_kind: model.enum(Object.values(XpRewardKind)),

  // XP debited for this redemption (positive integer).
  xp_cost: model.number(),

  // The entitlement feature_key this redemption grants / gates.
  feature_key: model.text().nullable(),

  status: model
    .enum(Object.values(XpRedemptionStatus))
    .default(XpRedemptionStatus.PENDING),

  // Reference to the granted entitlement, once fulfilled.
  entitlement_id: model.text().nullable(),

  fulfilled_at: model.dateTime().nullable(),

  metadata: model.json().nullable(),
})
  .indexes([
    { on: ["customer_id"], name: "IDX_xp_redemption_customer_id" },
    { on: ["reward_key"], name: "IDX_xp_redemption_reward_key" },
    { on: ["status"], name: "IDX_xp_redemption_status" },
  ])

export default XpRedemption
