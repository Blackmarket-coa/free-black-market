import { model } from "@medusajs/framework/utils"

export const FORMULA_STATUSES = ["draft", "approved", "deprecated"] as const
export type FormulaStatus = (typeof FORMULA_STATUSES)[number]

/**
 * Formula — a maker's versioned recipe for one pathway (tincture ratio, salve
 * blend, dye bath, …). Ingredients are stored as a JSON array of
 * `FormulaIngredient` objects (display/INCI/botanical names, per-batch amount,
 * sourcing flags) mirroring the botanical-portal `Formula` type.
 */
const Formula = model.define("botanical_formula", {
  id: model.id().primaryKey(),

  // Owning maker (seller). Every list query is scoped to this.
  maker_id: model.text(),
  pathway_id: model.text(),

  name: model.text(),
  description: model.text().nullable(),
  version: model.text().default("1.0.0"),
  status: model.enum([...FORMULA_STATUSES]).default("draft"),

  // FormulaIngredient[] — see botanical-portal types.
  ingredients: model.json(),
  instructions: model.text().nullable(),

  yield_units: model.number().default(0),
  yield_unit_type: model.text().default("unit"),
  cure_time_days: model.number().nullable(),
  shelf_life_days: model.number().nullable(),
  storage_conditions: model.text().nullable(),
  ph_target: model.float().nullable(),

  label_claims: model.json().nullable(), // string[]
  allergens: model.json().nullable(), // string[]

  cost_per_unit_cents: model.number().default(0),
  target_retail_price_cents: model.number().default(0),
  target_wholesale_price_cents: model.number().default(0),

  label_reviewed: model.boolean().default(false),

  metadata: model.json().nullable(),
})
  .indexes([
    { on: ["maker_id"], name: "IDX_botanical_formula_maker_id" },
    { on: ["pathway_id"], name: "IDX_botanical_formula_pathway_id" },
  ])

export default Formula
