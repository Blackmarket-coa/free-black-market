import type { OutputCategory, ComplianceFrameworkId } from "../models"

/**
 * Built-in pathway templates — the canonical set a maker starts from. This is
 * the backend source of truth mirrored by botanical-portal `PATHWAY_TEMPLATES`
 * (the portal keeps a copy so its mock seam works without a backend). The
 * activate endpoint resolves `template_id` against this catalog to derive the
 * compliance framework, output category, and per-pathway defaults.
 */
export interface PathwayTemplate {
  id: string
  name: string
  icon: string
  blurb: string
  compliance_note: string
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
  production_status_labels?: Record<string, string>
  material_category_labels?: Record<string, string>
  yield_unit_options?: string[]
}

export const PATHWAY_TEMPLATES: PathwayTemplate[] = [
  {
    id: "dried_botanical",
    name: "Dried Botanicals",
    icon: "🌿",
    blurb: "Herb bundles, teas, spice blends, wreaths, dried flower.",
    compliance_note: "Food label · Cottage food eligible · No special testing.",
    output_category: "dried_botanical",
    compliance_framework_id: "fda_food",
    shelf_life_min_days: 180,
    shelf_life_max_days: 730,
    shelf_life_note: "1–2 years. Cool, dark, dry storage.",
    requires_ph_testing: false,
    counts_toward_cottage_food_limit: true,
    batch_number_prefix: "DRY",
    production_status_labels: { in_progress: "Drying", curing: "Finishing" },
    yield_unit_options: ["oz", "bundle", "g", "packet"],
  },
  {
    id: "extract_tincture",
    name: "Extracts & Tinctures",
    icon: "💧",
    blurb: "Alcohol tinctures, glycerites, herbal vinegars, oxymel.",
    compliance_note: "FDA Supplement or food label · Cottage food eligible · 28-day cure.",
    output_category: "extract_tincture",
    compliance_framework_id: "fda_supplement",
    shelf_life_min_days: 365,
    shelf_life_max_days: 1825,
    shelf_life_note: "Alcohol: 3–5 years. Glycerite: 1–2 years. Vinegar: 1 year.",
    default_cure_time_days: 28,
    requires_ph_testing: false,
    counts_toward_cottage_food_limit: true,
    batch_number_prefix: "TNC",
    production_status_labels: { in_progress: "Macerating", curing: "Macerating" },
    material_category_labels: { plant_material: "Botanical", carrier_base: "Menstruum" },
    yield_unit_options: ["1oz bottle", "2oz bottle", "4oz bottle", "ml"],
  },
  {
    id: "cosmetic_body_care",
    name: "Body & Skin Care",
    icon: "🧴",
    blurb: "Body butters, salves, lip balms, facial oils, hair products.",
    compliance_note: "FDA Cosmetic · INCI names on label · No health claims.",
    output_category: "cosmetic_body_care",
    compliance_framework_id: "fda_cosmetic",
    shelf_life_min_days: 180,
    shelf_life_max_days: 730,
    shelf_life_note: "Anhydrous: 12–24 months. Water-containing: 6–12 months.",
    requires_ph_testing: false,
    counts_toward_cottage_food_limit: false,
    batch_number_prefix: "BDY",
    production_status_labels: { in_progress: "Mixing & Filling" },
    material_category_labels: {
      plant_material: "Botanical Infusion",
      carrier_base: "Carrier (Oil/Butter/Wax)",
      additive: "Additive (Preservative/Fragrance/Vitamin)",
    },
    yield_unit_options: ["2oz jar", "4oz jar", "lip tube", "1oz bottle"],
  },
  {
    id: "infused_food",
    name: "Infused Foods",
    icon: "🍯",
    blurb: "Herbal honey, fire cider, shrubs, syrups.",
    compliance_note: "Food label · pH testing if below 4.6 · Cottage food eligible.",
    output_category: "prepared_food",
    compliance_framework_id: "fda_food",
    shelf_life_min_days: 180,
    shelf_life_max_days: 365,
    shelf_life_note: "Honey: 1 year. Fire cider: 1 year sealed. Syrup: 6–12 months refrigerated.",
    default_cure_time_days: 21,
    requires_ph_testing: true,
    ph_threshold: 4.6,
    counts_toward_cottage_food_limit: true,
    batch_number_prefix: "INF",
    production_status_labels: { in_progress: "Infusing", curing: "Mellowing" },
    yield_unit_options: ["4oz jar", "8oz jar", "12oz bottle", "16oz bottle"],
  },
  {
    id: "fermented",
    name: "Fermented Products",
    icon: "🫙",
    blurb: "Kombucha botanicals, herbal kvass, water kefir blends.",
    compliance_note: "Food label + pH testing · Cure time tracking.",
    output_category: "prepared_food",
    compliance_framework_id: "fda_acidified_food",
    shelf_life_min_days: 90,
    shelf_life_max_days: 365,
    shelf_life_note: "Refrigerated, sealed. pH must hold below 4.6.",
    default_cure_time_days: 14,
    requires_ph_testing: true,
    ph_threshold: 4.6,
    counts_toward_cottage_food_limit: true,
    batch_number_prefix: "FRM",
    production_status_labels: { in_progress: "Fermenting", curing: "Conditioning" },
    yield_unit_options: ["12oz bottle", "16oz bottle", "32oz growler"],
  },
  {
    id: "craft_fiber_dye",
    name: "Natural Dyes & Fiber Arts",
    icon: "🎨",
    blurb: "Indigo bundles, mordanted fiber, weld, woad, plant-dyed yarn.",
    compliance_note: "Craft supply — no regulatory framework · No cottage food limit.",
    output_category: "craft_fiber_dye",
    compliance_framework_id: "craft_supply",
    requires_ph_testing: false,
    counts_toward_cottage_food_limit: false,
    batch_number_prefix: "DYE",
    production_status_labels: { in_progress: "Dyeing", curing: "Setting", testing: "Color Testing" },
    material_category_labels: {
      plant_material: "Dye Plant",
      carrier_base: "Mordant",
      additive: "Modifier",
      fiber: "Fiber / Substrate",
    },
    yield_unit_options: ["bundle", "skein", "oz weight", "yard"],
  },
  {
    id: "seed_packet",
    name: "Seed Production",
    icon: "🌱",
    blurb: "Seed cleaning, packet assembly, rare variety preservation.",
    compliance_note: "Seed label law · Germination rate + test date required.",
    output_category: "seed_packet",
    compliance_framework_id: "seed_supply",
    shelf_life_note: "Viability varies by species. Retest germination annually.",
    requires_ph_testing: false,
    counts_toward_cottage_food_limit: false,
    batch_number_prefix: "SED",
    production_status_labels: {
      in_progress: "Cleaning & Sorting",
      curing: "Drying",
      testing: "Germination Testing",
    },
    material_category_labels: {
      plant_material: "Seed Stock",
      packaging: "Seed Packet",
      additive: "Desiccant",
    },
    yield_unit_options: ["packet", "g", "count"],
  },
  {
    id: "fungal_product",
    name: "Fungal Products",
    icon: "🍄",
    blurb: "Mushroom powder, lion's mane extract, dried mushroom, spores.",
    compliance_note: "Food or supplement label depending on claims.",
    output_category: "fungal_product",
    compliance_framework_id: "fda_food",
    shelf_life_min_days: 180,
    shelf_life_max_days: 730,
    shelf_life_note: "Dried/powder: 1–2 years airtight. Extract: per menstruum.",
    requires_ph_testing: false,
    counts_toward_cottage_food_limit: true,
    batch_number_prefix: "FNG",
    production_status_labels: { in_progress: "Processing", curing: "Drying" },
    material_category_labels: { plant_material: "Fungal Material", carrier_base: "Extraction Solvent" },
    yield_unit_options: ["g", "oz", "1oz bottle", "packet"],
  },
  {
    id: "bulk_ingredient",
    name: "Bulk Ingredient Supply",
    icon: "📦",
    blurb: "Raw herb, carrier oils, waxes, bases — wholesale to other makers.",
    compliance_note: "COA expected by buyers · No cottage food limit.",
    output_category: "bulk_ingredient",
    compliance_framework_id: "self_regulated",
    requires_ph_testing: false,
    coa_required_for_wholesale: true,
    counts_toward_cottage_food_limit: false,
    batch_number_prefix: "BLK",
    production_status_labels: { in_progress: "Processing & Packing" },
    yield_unit_options: ["lb", "kg", "oz", "case"],
  },
]

export function getPathwayTemplate(id: string): PathwayTemplate | undefined {
  return PATHWAY_TEMPLATES.find((t) => t.id === id)
}
