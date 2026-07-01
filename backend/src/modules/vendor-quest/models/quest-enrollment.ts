import { model } from "@medusajs/framework/utils"

export enum EnrollmentStatus {
  ACTIVE = "ACTIVE",
  DROPPED = "DROPPED",
  COMPLETE = "COMPLETE",
}

/**
 * Quest Enrollment — a vendor's opt-in to one quest.
 *
 * Quests are NEVER auto-enrolled; a row here exists only because the vendor
 * chose it from the catalog. `quest_key` references a code-config
 * `QuestDefinition` (definitions are not DB rows). Dropping sets `status =
 * DROPPED` and stamps `dropped_at` — it NEVER deletes the vendor's underlying
 * substrate records (that is a hard constraint, covered by a decoupling test).
 *
 * `current_stage` caches the last evaluated stage index for display; the source
 * of truth is always a fresh `evaluateQuest()` against the live substrate.
 */
const QuestEnrollment = model.define("quest_enrollment", {
  id: model.id().primaryKey(),

  seller_id: model.text(),
  quest_key: model.text(),

  status: model.enum(Object.values(EnrollmentStatus)).default(EnrollmentStatus.ACTIVE),

  current_stage: model.number().default(0),

  // Present for a member enrolled as part of a collective quest.
  collective_id: model.text().nullable(),

  enrolled_at: model.dateTime(),
  dropped_at: model.dateTime().nullable(),
  completed_at: model.dateTime().nullable(),

  metadata: model.json().nullable(),
})
  .indexes([
    { on: ["seller_id"], name: "IDX_quest_enrollment_seller_id" },
    { on: ["quest_key"], name: "IDX_quest_enrollment_quest_key" },
    { on: ["status"], name: "IDX_quest_enrollment_status" },
    { on: ["collective_id"], name: "IDX_quest_enrollment_collective_id" },
  ])

export default QuestEnrollment
