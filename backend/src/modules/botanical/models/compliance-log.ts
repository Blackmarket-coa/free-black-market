import { model } from "@medusajs/framework/utils"

export const PH_TEST_METHODS = ["meter", "strips", "lab"] as const
export type PhTestMethod = (typeof PH_TEST_METHODS)[number]

/**
 * pH Test Log — one equilibrium-pH reading against a batch. Required per batch
 * for acidified/fermented pathways (21 CFR 114); the compliance center reads
 * these to show testing coverage.
 */
export const PhTestLog = model.define("botanical_ph_test_log", {
  id: model.id().primaryKey(),

  maker_id: model.text(),
  pathway_id: model.text(),
  batch_number: model.text(),
  // Denormalized for the compliance table.
  formula_name: model.text(),

  test_date: model.dateTime(),
  ph_reading: model.float(),
  method: model.enum(PH_TEST_METHODS).default("meter"),
  pass: model.boolean(),
  notes: model.text().nullable(),

  metadata: model.json().nullable(),
}).indexes([
  { on: ["maker_id"], name: "IDX_botanical_ph_test_log_maker_id" },
  { on: ["batch_number"], name: "IDX_botanical_ph_test_log_batch_number" },
])

export const GERMINATION_TEST_METHODS = ["paper_towel", "soil", "lab"] as const
export type GerminationTestMethod = (typeof GERMINATION_TEST_METHODS)[number]

/**
 * Germination Log — a germination-rate test on a seed lot. Seed labeling law
 * requires the rate + test date on the packet; `alert` marks lots below 70% or
 * with a stale (>12 month) test.
 */
export const GerminationLog = model.define("botanical_germination_log", {
  id: model.id().primaryKey(),

  maker_id: model.text(),
  lot_number: model.text(),
  species_name: model.text(),
  botanical_name: model.text().nullable(),

  test_date: model.dateTime(),
  seeds_tested: model.number(),
  seeds_germinated: model.number(),
  germination_rate_pct: model.float(),
  method: model.enum(GERMINATION_TEST_METHODS).default("paper_towel"),
  alert: model.boolean().default(false),

  metadata: model.json().nullable(),
}).indexes([
  { on: ["maker_id"], name: "IDX_botanical_germination_log_maker_id" },
  { on: ["lot_number"], name: "IDX_botanical_germination_log_lot_number" },
])
