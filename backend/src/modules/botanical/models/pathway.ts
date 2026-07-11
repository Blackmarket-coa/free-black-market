import { model } from "@medusajs/framework/utils"

/**
 * Output category — what a pathway produces. Mirrors the botanical-portal
 * `OutputCategory` union so the maker UI and backend stay in lock-step.
 */
export const OUTPUT_CATEGORIES = [
  "dried_botanical",
  "extract_tincture",
  "prepared_food",
  "cosmetic_body_care",
  "craft_fiber_dye",
  "seed_packet",
  "fungal_product",
  "bulk_ingredient",
  "digital_recipe",
  "custom",
] as const
export type OutputCategory = (typeof OUTPUT_CATEGORIES)[number]

/**
 * Compliance framework — the regulatory regime a pathway falls under. Mirrors
 * the portal `ComplianceFrameworkId` union.
 */
export const COMPLIANCE_FRAMEWORK_IDS = [
  "fda_cosmetic",
  "fda_supplement",
  "fda_food",
  "fda_acidified_food",
  "craft_supply",
  "seed_supply",
  "self_regulated",
  "usda_organic",
] as const
export type ComplianceFrameworkId = (typeof COMPLIANCE_FRAMEWORK_IDS)[number]

/**
 * Production Pathway — a maker's activated product line. Every pathway-specific
 * behavior in the botanical portal (compliance, labeling, batch numbering,
 * workflow labels) is driven by this config. Created from a built-in template
 * and customized per maker; lives in the opt-in botanical vertical.
 */
const Pathway = model.define("botanical_pathway", {
  id: model.id().primaryKey(),

  // Owning maker (seller). Every list query is scoped to this.
  maker_id: model.text(),

  // The template this pathway was started from (nullable for custom pathways).
  template_id: model.text().nullable(),

  // The maker's own name for this product line.
  name: model.text(),

  output_category: model.enum(OUTPUT_CATEGORIES),
  compliance_framework_id: model.enum(COMPLIANCE_FRAMEWORK_IDS),

  is_active: model.boolean().default(true),

  shelf_life_min_days: model.number().nullable(),
  shelf_life_max_days: model.number().nullable(),
  shelf_life_note: model.text().nullable(),
  default_cure_time_days: model.number().nullable(),

  requires_ph_testing: model.boolean().default(false),
  ph_threshold: model.float().nullable(),

  coa_required_for_wholesale: model.boolean().default(false),
  counts_toward_cottage_food_limit: model.boolean().default(false),

  // [PREFIX-]YYYYMMDD-NNN batch numbering; 2–4 char prefix.
  batch_number_prefix: model.text().nullable(),

  // Pathway-specific display/label overrides (JSON maps) and claim-rule adds.
  production_status_labels: model.json().nullable(),
  material_category_labels: model.json().nullable(),
  custom_forbidden_patterns: model.json().nullable(),
  yield_unit_options: model.json().nullable(),

  metadata: model.json().nullable(),
})
  .indexes([
    { on: ["maker_id"], name: "IDX_botanical_pathway_maker_id" },
    { on: ["is_active"], name: "IDX_botanical_pathway_is_active" },
  ])

export default Pathway
