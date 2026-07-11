import { model } from "@medusajs/framework/utils"

/**
 * Propagation method — how a batch was started. Mirrors the nursery-portal
 * `PropagationMethod` union so the vendor UI and backend stay in lock-step.
 */
export const PROPAGATION_METHODS = [
  "seed",
  "cutting",
  "plug",
  "bareroot",
  "division",
  "airlayer",
  "layering",
  "graft",
  "offset",
] as const
export type PropagationMethod = (typeof PROPAGATION_METHODS)[number]

/**
 * Batch status machine — transitions only move forward (except `failed`, which
 * is terminal from any state). Mirrors the portal `BatchStatus` union.
 */
export const PROPAGATION_BATCH_STATUSES = [
  "started",
  "germinating",
  "rooting",
  "growing_out",
  "ready",
  "listed",
  "sold_out",
  "failed",
] as const
export type PropagationBatchStatus = (typeof PROPAGATION_BATCH_STATUSES)[number]

/**
 * Propagation Batch — a tracked run of plant propagation owned by a nursery
 * vendor (seed tray, cutting flat, division lot, …). Lives in the opt-in
 * nursery vertical; core carries no propagation assumptions.
 *
 * `expected_ready_at` is estimated at creation from species reference data
 * (weeks-to-saleable) and persisted so the vendor's seasonal planner and the
 * Blackout node room can surface upcoming availability.
 */
const PropagationBatch = model.define("propagation_batch", {
  id: model.id().primaryKey(),

  // Owning vendor. Every list query is scoped to this so a nursery only ever
  // sees its own batches.
  seller_id: model.text(),

  species_name: model.text(),
  method: model.enum(PROPAGATION_METHODS),
  status: model.enum(PROPAGATION_BATCH_STATUSES).default("started"),

  // How many units were started vs. how many survived to a saleable state.
  qty_started: model.number(),
  qty_successful: model.number().default(0),

  started_at: model.dateTime(),
  expected_ready_at: model.dateTime(),

  pot_size: model.text().nullable(),
  is_rare_species: model.boolean().default(false),
  hub_requested: model.boolean().default(false),

  // Progress-photo verification (drives KARMA photo quests on the portal side).
  photo_url: model.text().nullable(),
  photo_verified_at: model.dateTime().nullable(),

  notes: model.text().nullable(),

  metadata: model.json().nullable(),
})
  .indexes([
    { on: ["seller_id"], name: "IDX_propagation_batch_seller_id" },
    { on: ["status"], name: "IDX_propagation_batch_status" },
    { on: ["expected_ready_at"], name: "IDX_propagation_batch_expected_ready_at" },
  ])

export default PropagationBatch
