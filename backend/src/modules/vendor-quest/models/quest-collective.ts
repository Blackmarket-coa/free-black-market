import { model } from "@medusajs/framework/utils"

export enum CollectiveStatus {
  FORMING = "FORMING",
  ACTIVE = "ACTIVE",
  COMPLETE = "COMPLETE",
  DISBANDED = "DISBANDED",
}

/**
 * Quest Collective — a group of vendors pursuing a collective quest (Q11–Q13).
 *
 * Members join via their own `quest_enrollment` (carrying `collective_id`) and
 * grant scoped consent (`quest_member_consent`) before any of their substrate
 * is aggregated. The engine aggregates ONLY consenting members' data and never
 * leaks one vendor's records to another.
 */
const QuestCollective = model.define("quest_collective", {
  id: model.id().primaryKey(),

  quest_key: model.text(),
  title: model.text(),
  owner_seller_id: model.text(),

  status: model.enum(Object.values(CollectiveStatus)).default(CollectiveStatus.FORMING),

  metadata: model.json().nullable(),
})
  .indexes([
    { on: ["quest_key"], name: "IDX_quest_collective_quest_key" },
    { on: ["owner_seller_id"], name: "IDX_quest_collective_owner" },
  ])

export default QuestCollective
