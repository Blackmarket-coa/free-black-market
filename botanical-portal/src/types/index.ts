// ============================================================================
// Botanical Portal — domain types
//
// The portal is generalized: instead of hardcoded product lines, every
// pathway-specific behavior is driven by a ProductionPathway config. These
// mirror the backend models (src/modules/botanical/* — a follow-up build) and
// are the source of truth the UI reads from.
// ============================================================================

export type OperatorType = "maker" | "collective"

// ── Pathway core ────────────────────────────────────────────────────────────

export type OutputCategory =
  | "dried_botanical" // herb, tea, spice, bundle, wreath
  | "extract_tincture" // alcohol, glycerite, vinegar, oxymel
  | "prepared_food" // syrup, honey infusion, fire cider, ferments
  | "cosmetic_body_care" // butter, salve, serum, balm, lip care
  | "craft_fiber_dye" // natural dye, fiber, basketry, cordage
  | "seed_packet" // cleaned seeds, rare variety packets
  | "fungal_product" // mushroom powder, extract, spore
  | "bulk_ingredient" // wholesale raw material to other makers
  | "digital_recipe" // PDF guide, workshop download
  | "custom" // maker-defined

export type ComplianceFrameworkId =
  | "fda_cosmetic" // 21 CFR 700 — cosmetics
  | "fda_supplement" // DSHEA — dietary supplements
  | "fda_food" // 21 CFR 101 — food label
  | "fda_acidified_food" // 21 CFR 114 — pH < 4.6 commercial
  | "craft_supply" // no regulatory framework required
  | "seed_supply" // seed labeling (germination, lot, test date)
  | "self_regulated" // maker-defined
  | "usda_organic" // add-on certification

export type RunStatus =
  | "planned"
  | "in_progress"
  | "curing"
  | "testing"
  | "complete"
  | "failed"
  | "quarantine"

export type MaterialCategory =
  | "plant_material"
  | "carrier_base"
  | "additive"
  | "packaging"
  | "fiber"
  | "fungal"
  | "seed"
  | "hardware"
  | "other"

export type MaterialSource =
  | "bmc_nursery"
  | "own_harvest"
  | "foraged"
  | "external_supplier"
  | "traded"

export interface ProductionPathway {
  id: string
  maker_id: string
  name: string // the maker's own name for this product line
  output_category: OutputCategory
  compliance_framework_id: ComplianceFrameworkId
  is_active: boolean
  shelf_life_min_days?: number
  shelf_life_max_days?: number
  shelf_life_note?: string
  default_cure_time_days?: number
  requires_ph_testing: boolean
  ph_threshold?: number // default 4.6
  coa_required_for_wholesale: boolean
  counts_toward_cottage_food_limit: boolean
  batch_number_prefix?: string // TNC, DYE, SED, FNG — 2–4 chars
  production_status_labels?: Partial<Record<RunStatus, string>>
  material_category_labels?: Partial<Record<MaterialCategory, string>>
  custom_forbidden_patterns?: string[]
  yield_unit_options?: string[]
  // Denormalized counts for the Pathways page cards.
  formula_count?: number
  active_run_count?: number
  created_at?: string
  updated_at?: string
}

// A built-in template the maker can start from. Same shape as a pathway minus
// the per-maker fields; the configure step fills the rest in.
export interface PathwayTemplate {
  id: string
  name: string
  icon: string
  blurb: string // plain-English "what do you make?"
  compliance_note: string // one short regulatory note
  output_category: OutputCategory
  compliance_framework_id: ComplianceFrameworkId
  shelf_life_min_days?: number
  shelf_life_max_days?: number
  shelf_life_note?: string
  default_cure_time_days?: number
  requires_ph_testing: boolean
  ph_threshold?: number
  coa_required_for_wholesale?: boolean
  counts_toward_cottage_food_limit: boolean
  batch_number_prefix?: string
  production_status_labels?: Partial<Record<RunStatus, string>>
  material_category_labels?: Partial<Record<MaterialCategory, string>>
  yield_unit_options?: string[]
}

// ── Compliance ──────────────────────────────────────────────────────────────

export interface ComplianceFramework {
  id: ComplianceFrameworkId
  name: string
  summary: string
  label_required_fields: string[]
  forbidden_patterns: string[] // raw regex source strings, compiled at runtime
  disclaimer_required: boolean
  facility_requirements: string[]
  source_url?: string
}

export interface ResolvedCompliance {
  framework: ComplianceFramework
  label_required_fields: string[]
  forbidden_patterns: string[] // framework + pathway overrides, merged
  disclaimer_required: boolean
  context_note: string // the plain-English line shown in the formula stepper
}

export interface ClaimFlag {
  flagged_phrase: string
  reason: string
  suggestion: string
}

// ── Formula ─────────────────────────────────────────────────────────────────

export interface FormulaIngredient {
  ingredient_id: string
  display_name: string
  inci_name?: string
  botanical_name?: string
  common_name: string
  amount_per_batch: number
  unit: string
  pct_of_formula?: number
  bmc_sourced: boolean
  bmc_grower_node?: string
  own_harvest: boolean
  foraged: boolean
  substitute_ok: boolean
}

export interface Formula {
  id: string
  maker_id: string
  pathway_id: string
  name: string
  description?: string
  version: string // semver
  status: "draft" | "approved" | "deprecated"
  ingredients: FormulaIngredient[]
  instructions?: string
  yield_units: number
  yield_unit_type: string
  cure_time_days?: number
  shelf_life_days?: number
  storage_conditions?: string
  ph_target?: number
  label_claims: string[]
  allergens: string[]
  cost_per_unit_cents: number
  target_retail_price_cents: number
  target_wholesale_price_cents: number
  label_reviewed: boolean
  updated_at?: string
}

// ── Production runs ─────────────────────────────────────────────────────────

export interface ProductionRun {
  id: string
  maker_id: string
  formula_id: string
  formula_name: string
  pathway_id: string
  batch_number: string // [PREFIX-]YYYYMMDD-NNN
  planned_date: string
  actual_start_date?: string
  actual_complete_date?: string
  cure_complete_date?: string
  planned_yield_units: number
  actual_yield_units?: number
  yield_unit_type: string
  status: RunStatus
  total_cost_cents: number
  qc_passed?: boolean
  ph_reading?: number
  coa_url?: string
  notes?: string
}

// ── Raw materials ───────────────────────────────────────────────────────────

export interface RawMaterialLot {
  lot_number: string
  source: MaterialSource
  bmc_grower_node?: string
  bmc_order_id?: string
  purchase_date: string
  quantity: number
  unit: string
  remaining: number
  expiry_date?: string
  cost_cents: number
  coa_url?: string
}

export interface RawMaterial {
  id: string
  maker_id: string
  name: string
  common_name: string
  botanical_name?: string
  category: MaterialCategory
  pathway_id?: string // the pathway this material is most used in
  source_default: MaterialSource
  current_stock: number
  stock_unit: string
  reorder_threshold: number
  cost_per_unit_cents: number
  lots: RawMaterialLot[]
}

// ── Finished goods ──────────────────────────────────────────────────────────

export interface FinishedGood {
  id: string
  maker_id: string
  formula_id: string
  pathway_id: string
  output_category: OutputCategory
  batch_number: string
  sku: string
  product_name: string
  quantity_on_hand: number
  unit_size: string
  unit_type: string
  manufacture_date: string
  expiry_date?: string
  germination_rate?: number
  germination_test_date?: string
  status: "available" | "reserved" | "shipped" | "quarantine" | "expired"
  is_wholesale_eligible: boolean
  retail_price_cents: number
  wholesale_price_cents: number
  label_approved: boolean
  coa_required: boolean
  coa_url?: string
}

// ── Compliance logs ─────────────────────────────────────────────────────────

export interface PhTestLog {
  id: string
  batch_number: string
  formula_name: string
  pathway_id: string
  test_date: string
  ph_reading: number
  method: "meter" | "strips" | "lab"
  pass: boolean
  notes?: string
}

export interface GerminationLog {
  id: string
  lot_number: string
  species_name: string
  botanical_name?: string
  test_date: string
  seeds_tested: number
  seeds_germinated: number
  germination_rate_pct: number
  method: "paper_towel" | "soil" | "lab"
  alert: boolean // rate < 70 OR test > 12 months old
}

// ── Dashboard view models ───────────────────────────────────────────────────

export interface UrgentAction {
  // Reuses the shared UrgentBanner icon set.
  type: "orders" | "inventory" | "seasonal" | "quest" | "compliance"
  message: string
  link: string
}

export interface DashboardSummary {
  active_pathways: ProductionPathway[]
  urgent_actions: UrgentAction[]
  todays_metrics: {
    active_runs: number
    finished_units_on_hand: number
    active_formulas: number
    month_earnings_cents: number
  }
  production_queue: ProductionRun[]
  inventory_alerts: { id: string; label: string; detail: string; severity: "high" | "med" | "low" }[]
  bmc_sourced_pct: number // portfolio-wide
  quest_highlights: {
    quest_title: string
    current: number
    required: number
    karma_reward: number
  }[]
}

// ── Compliance center view model ────────────────────────────────────────────

export interface ComplianceOverview {
  pathway_rows: {
    pathway_id: string
    pathway_name: string
    output_category: OutputCategory
    framework_id: ComplianceFrameworkId
    status: "ok" | "attention" | "none_required"
    note: string
  }[]
  cottage_food: {
    enabled: boolean
    state: string
    ytd_revenue_cents: number
    cap_cents: number
  }
  ph_logs: PhTestLog[]
  germination_logs: GerminationLog[]
}
