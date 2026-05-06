import { model } from "@medusajs/framework/utils"

export enum RewardPayoutStatus {
  PENDING = "pending",
  HELD = "held",
  PAID = "paid",
  REVERSED = "reversed",
}

const RewardPayout = model
  .define("reward_payout", {
    id: model.id().primaryKey(),

    pool_id: model.text(),
    creator_seller_id: model.text(),

    qualified_views: model.bigNumber().default(0),
    qualified_engagement_score: model.float().default(0),
    amount_cents: model.bigNumber(),
    currency_code: model.text().default("usd"),

    status: model
      .enum(Object.values(RewardPayoutStatus))
      .default(RewardPayoutStatus.PENDING),

    ledger_entry_id: model.text().nullable(),
    metadata: model.json().nullable(),
  })
  .indexes([
    {
      on: ["pool_id"],
      name: "IDX_reward_payout_pool",
    },
    {
      on: ["creator_seller_id", "status"],
      name: "IDX_reward_payout_creator_status",
    },
  ])

export default RewardPayout
