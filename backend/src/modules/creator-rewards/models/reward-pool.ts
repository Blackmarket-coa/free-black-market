import { model } from "@medusajs/framework/utils"

export enum RewardPoolKind {
  ENGAGEMENT = "engagement",
  THROUGHPUT = "throughput",
}

export enum RewardPoolStatus {
  SCHEDULED = "scheduled",
  ACCRUING = "accruing",
  CALCULATING = "calculating",
  DISTRIBUTED = "distributed",
  REVERTED = "reverted",
}

const RewardPool = model
  .define("reward_pool", {
    id: model.id().primaryKey(),

    program_id: model.text().nullable(),
    funder_seller_id: model.text().nullable(),

    kind: model.enum(Object.values(RewardPoolKind)).default(RewardPoolKind.ENGAGEMENT),

    period_start: model.dateTime(),
    period_end: model.dateTime(),

    total_cents: model.bigNumber(),
    rate_per_kqv_cents: model.number().nullable(),
    currency_code: model.text().default("usd"),

    status: model
      .enum(Object.values(RewardPoolStatus))
      .default(RewardPoolStatus.SCHEDULED),

    distributed_at: model.dateTime().nullable(),
    metadata: model.json().nullable(),
  })
  .indexes([
    {
      on: ["program_id"],
      name: "IDX_reward_pool_program",
    },
    {
      on: ["status", "period_end"],
      name: "IDX_reward_pool_status_end",
    },
  ])

export default RewardPool
