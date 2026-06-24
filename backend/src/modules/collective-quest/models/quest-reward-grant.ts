import { model } from "@medusajs/framework/utils"

/**
 * Quest Reward Grant (append-only).
 *
 * Records each member's share of a completed quest's `reward_pool_xp`. The
 * actual XP is awarded through the progression service (`recordXpEvent`); this
 * row is the audit trail of how the shared pool was distributed.
 */
const QuestRewardGrant = model.define("quest_reward_grant", {
  id: model.id().primaryKey(),

  quest_id: model.text(),
  customer_id: model.text(),

  xp_amount: model.number(),

  metadata: model.json().nullable(),
})
  .indexes([
    { on: ["quest_id"], name: "IDX_quest_reward_grant_quest_id" },
    { on: ["customer_id"], name: "IDX_quest_reward_grant_customer_id" },
  ])

export default QuestRewardGrant
