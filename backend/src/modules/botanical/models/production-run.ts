import { model } from "@medusajs/framework/utils"

/** Run status machine — mirrors the botanical-portal `RunStatus` union. */
export const RUN_STATUSES = [
  "planned",
  "in_progress",
  "curing",
  "testing",
  "complete",
  "failed",
  "quarantine",
] as const
export type RunStatus = (typeof RUN_STATUSES)[number]

/**
 * Production Run — one batch made from a formula. Carries the pathway-prefixed
 * batch number ([PREFIX-]YYYYMMDD-NNN), planned vs. actual yield, and QC
 * results (pH reading, COA link).
 */
const ProductionRun = model.define("botanical_production_run", {
  id: model.id().primaryKey(),

  maker_id: model.text(),
  formula_id: model.text(),
  // Denormalized for run lists (formula rename should not rewrite history).
  formula_name: model.text(),
  pathway_id: model.text(),

  batch_number: model.text(),

  planned_date: model.dateTime(),
  actual_start_date: model.dateTime().nullable(),
  actual_complete_date: model.dateTime().nullable(),
  cure_complete_date: model.dateTime().nullable(),

  planned_yield_units: model.number().default(0),
  actual_yield_units: model.number().nullable(),
  yield_unit_type: model.text().default("unit"),

  status: model.enum(RUN_STATUSES).default("planned"),

  total_cost_cents: model.number().default(0),

  qc_passed: model.boolean().nullable(),
  ph_reading: model.float().nullable(),
  coa_url: model.text().nullable(),
  notes: model.text().nullable(),

  metadata: model.json().nullable(),
})
  .indexes([
    { on: ["maker_id"], name: "IDX_botanical_production_run_maker_id" },
    { on: ["pathway_id"], name: "IDX_botanical_production_run_pathway_id" },
    { on: ["status"], name: "IDX_botanical_production_run_status" },
    { on: ["batch_number"], name: "IDX_botanical_production_run_batch_number" },
  ])

export default ProductionRun
