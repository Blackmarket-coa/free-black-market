import { model } from "@medusajs/framework/utils"

export enum QuestStatus {
  ACTIVE = "ACTIVE",
  COMPLETE = "COMPLETE",
  EXPIRED = "EXPIRED",
}

/**
 * Collective Quest (Habitica-style group "boss").
 *
 * Members reduce `hp_remaining` through **verified** contributions; when it
 * reaches 0 the quest completes and `reward_pool_xp` is split across
 * contributors (COALITION XP). A quest may be attached to a `goal_id`
 * thermometer and/or a `den_id` cooperative.
 */
const CollectiveQuest = model.define("collective_quest", {
  id: model.id().primaryKey(),

  goal_id: model.text().nullable(),
  den_id: model.text().nullable(),

  title: model.text(),
  description: model.text().nullable(),

  boss_hp: model.number(),
  hp_remaining: model.number(),

  // Shared XP pool distributed across contributors on completion.
  reward_pool_xp: model.number().default(0),

  status: model.enum(Object.values(QuestStatus)).default(QuestStatus.ACTIVE),

  metadata: model.json().nullable(),
})
  .indexes([
    { on: ["den_id"], name: "IDX_collective_quest_den_id" },
    { on: ["goal_id"], name: "IDX_collective_quest_goal_id" },
    { on: ["status"], name: "IDX_collective_quest_status" },
  ])

export default CollectiveQuest
