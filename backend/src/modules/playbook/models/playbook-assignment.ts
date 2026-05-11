import { model } from "@medusajs/framework/utils"

/**
 * PlaybookAssignment
 *
 * One row per seller capturing which playbook they picked and (when
 * available) the 3-question picker answers that informed the
 * recommendation. The `overridden` flag is set true when the user picked
 * a different playbook than the recommendation suggested.
 *
 * Migrated sellers (created before the picker shipped) have
 * `q1_size`, `q2_governance`, `q3_offering` null and `migrated_from`
 * populated with their legacy `vendor_type`.
 *
 * The row is unique by `seller_id` — a seller has exactly one current
 * playbook. Re-running the picker updates this row (and writes a history
 * trail via the audit log, not a separate table).
 */
const PlaybookAssignment = model.define("playbook_assignment", {
  id: model.id().primaryKey(),

  /** Link to MercurJS Seller. */
  seller_id: model.text().unique(),

  /** Link to playbook.id (the registry row), set on assignment. */
  playbook_id: model.text(),

  /** Recipe id (denormalized for query convenience). */
  recipe_id: model.text(),

  /** 3-question picker answers (nullable for legacy backfill). */
  q1_size: model.text().nullable(),
  q2_governance: model.text().nullable(),
  q3_offering: model.text().nullable(),

  /**
   * The playbook the picker recommended at assignment time. May differ
   * from `recipe_id` when the user opted to "see other options" and pick
   * a different one. Useful for tuning the decision tree over time.
   */
  recommended_recipe_id: model.text().nullable(),

  /** True when the user picked a different playbook than the recommendation. */
  overridden: model.boolean().default(false),

  /** For backfilled rows, the legacy vendor_type they migrated from. */
  migrated_from: model.text().nullable(),

  assigned_at: model.dateTime(),

  metadata: model.json().nullable(),
}).indexes([
  { on: ["seller_id"], name: "IDX_playbook_assignment_seller_id" },
  { on: ["playbook_id"], name: "IDX_playbook_assignment_playbook_id" },
  { on: ["recipe_id"], name: "IDX_playbook_assignment_recipe_id" },
])

export default PlaybookAssignment
