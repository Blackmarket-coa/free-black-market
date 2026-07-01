import { model } from "@medusajs/framework/utils"

/**
 * Quest Stage Event — append-only ledger of stage-gate transitions.
 *
 * Mirrors the `xp_event` / `quest_contribution` append-only convention. Each
 * time a vendor advances a gate we write one row (never mutate/delete) with a
 * snapshot of the evaluation that justified it — the audit trail behind any XP
 * award and any packet unlock.
 */
const QuestStageEvent = model.define("quest_stage_event", {
  id: model.id().primaryKey(),

  enrollment_id: model.text(),
  seller_id: model.text(),
  quest_key: model.text(),

  from_stage: model.number(),
  to_stage: model.number(),
  stage_key: model.text().nullable(),

  // Snapshot of the QuestEvaluation (or the relevant slice) at transition time.
  evaluated_snapshot: model.json().nullable(),

  // How many XP were credited for this transition (0 if none / best-effort).
  xp_awarded: model.number().default(0),

  metadata: model.json().nullable(),
})
  .indexes([
    { on: ["enrollment_id"], name: "IDX_quest_stage_event_enrollment_id" },
    { on: ["seller_id"], name: "IDX_quest_stage_event_seller_id" },
  ])

export default QuestStageEvent
