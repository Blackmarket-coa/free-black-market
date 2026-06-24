import { model } from "@medusajs/framework/utils"

/**
 * Quest Contribution (append-only).
 *
 * One member's contribution toward a quest boss. Boss HP only drops for
 * **verified** contributions (`verified = true`) — reusing the peer-attestation
 * principle so collective progress can't be farmed (ADR-0004).
 */
const QuestContribution = model.define("quest_contribution", {
  id: model.id().primaryKey(),

  quest_id: model.text(),
  customer_id: model.text(),

  source_module: model.text().nullable(),
  source_id: model.text().nullable(),

  // HP this contribution removes from the boss (only applied when verified).
  hp_reduction: model.number(),

  verified: model.boolean().default(false),

  metadata: model.json().nullable(),
})
  .indexes([
    { on: ["quest_id"], name: "IDX_quest_contribution_quest_id" },
    { on: ["customer_id"], name: "IDX_quest_contribution_customer_id" },
  ])

export default QuestContribution
