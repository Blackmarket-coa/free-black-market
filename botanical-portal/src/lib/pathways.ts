// ============================================================================
// Pathway logic — the source of truth for every pathway-specific behavior.
//
// Built-in pathway templates + the compliance-framework registry live here, as
// does the claim checker and the label-resolution logic. In production this
// mirrors the seeded backend data (pathway-templates.seed.ts +
// compliance-frameworks.seed.ts) and the PathwayService; the UI keeps a copy so
// the mock seam works without a backend, exactly like nursery-portal.
// ============================================================================

import type {
  ClaimFlag,
  ComplianceFramework,
  ComplianceFrameworkId,
  MaterialCategory,
  PathwayTemplate,
  ProductionPathway,
  ResolvedCompliance,
  RunStatus,
} from "@/types"

// ── Default labels (used when a pathway doesn't override) ───────────────────

export const DEFAULT_RUN_STATUS_LABELS: Record<RunStatus, string> = {
  planned: "Planned",
  in_progress: "In progress",
  curing: "Curing",
  testing: "Testing",
  complete: "Complete",
  failed: "Failed",
  quarantine: "Quarantine",
}

export const DEFAULT_CATEGORY_LABELS: Record<MaterialCategory, string> = {
  plant_material: "Plant Material",
  carrier_base: "Carrier / Base",
  additive: "Additive",
  packaging: "Packaging",
  fiber: "Fiber",
  fungal: "Fungal",
  seed: "Seed",
  hardware: "Hardware",
  other: "Other",
}

// ── Compliance framework registry ───────────────────────────────────────────
// forbidden_patterns are raw regex sources, compiled at runtime in checkClaims.

export const COMPLIANCE_FRAMEWORKS: Record<ComplianceFrameworkId, ComplianceFramework> = {
  fda_cosmetic: {
    id: "fda_cosmetic",
    name: "FDA Cosmetic (21 CFR 700)",
    summary:
      "Cosmetics may make appearance claims only. INCI names required on the label. No drug or health claims.",
    label_required_fields: [
      "Product identity",
      "Net quantity (oz + metric)",
      "INCI ingredient list (descending)",
      "Maker name & address",
      "Directions / warnings",
    ],
    forbidden_patterns: [
      "\\bcure[sd]?\\b",
      "\\btreat(s|ment|ed)?\\b",
      "\\bheal(s|ing|ed)?\\b",
      "\\banti-?inflammator(y|ies)\\b",
      "\\bantibacterial\\b",
      "\\bprevents?\\b",
      "\\bdisease\\b",
      "\\beczema\\b",
      "\\bpsoriasis\\b",
      "\\bdiagnos(e|is|tic)\\b",
    ],
    disclaimer_required: false,
    facility_requirements: [
      "Good manufacturing practices (voluntary but expected)",
      "Batch records retained",
    ],
    source_url: "https://www.fda.gov/cosmetics",
  },
  fda_supplement: {
    id: "fda_supplement",
    name: "FDA Dietary Supplement (DSHEA)",
    summary:
      "Structure/function claims only, with the DSHEA disclaimer. Disease claims are prohibited. Supplement Facts panel required.",
    label_required_fields: [
      "Statement of identity ('dietary supplement')",
      "Net quantity",
      "Supplement Facts panel",
      "Ingredient list with botanical (Latin) names",
      "Maker name & address",
      "DSHEA disclaimer",
    ],
    forbidden_patterns: [
      "\\bcure[sd]?\\b",
      "\\btreat(s|ment|ed)?\\b",
      "\\bprevents?\\b",
      "\\bdiagnos(e|is|tic)\\b",
      "\\bdisease\\b",
      "\\binsomnia\\b",
      "\\bdepression\\b",
      "\\banxiety\\b",
      "\\binfection\\b",
      "\\bcancer\\b",
      "\\blowers? blood pressure\\b",
    ],
    disclaimer_required: true,
    facility_requirements: [
      "cGMP for dietary supplements (21 CFR 111)",
      "Batch & ingredient lot records",
    ],
    source_url: "https://www.fda.gov/food/dietary-supplements",
  },
  fda_food: {
    id: "fda_food",
    name: "FDA Food Label (21 CFR 101)",
    summary:
      "Standard food labeling: common names, allergen declaration, net weight. No health/disease claims without authorization.",
    label_required_fields: [
      "Statement of identity",
      "Net weight (oz + metric)",
      "Ingredient list (common names, descending)",
      "Allergen declaration",
      "Maker name & address",
    ],
    forbidden_patterns: [
      "\\bcure[sd]?\\b",
      "\\btreat(s|ment|ed)?\\b",
      "\\bprevents?\\b",
      "\\bdisease\\b",
      "\\bdetox(es|ifies|ifying)?\\b",
      "\\bboosts? immunity\\b",
    ],
    disclaimer_required: false,
    facility_requirements: [
      "Cottage food or licensed kitchen per state",
      "Allergen control",
    ],
    source_url: "https://www.fda.gov/food/food-labeling-nutrition",
  },
  fda_acidified_food: {
    id: "fda_acidified_food",
    name: "FDA Acidified Food (21 CFR 114)",
    summary:
      "Acidified / fermented foods must hold equilibrium pH below 4.6. Process filing and pH records required for commercial sale.",
    label_required_fields: [
      "Statement of identity",
      "Net weight",
      "Ingredient list + allergens",
      "Maker name & address",
      "Keep-refrigerated notice (if applicable)",
    ],
    forbidden_patterns: [
      "\\bcure[sd]?\\b",
      "\\btreat(s|ment|ed)?\\b",
      "\\bprevents?\\b",
      "\\bdisease\\b",
      "\\bdetox(es|ifies|ifying)?\\b",
    ],
    disclaimer_required: false,
    facility_requirements: [
      "Better Process Control School (for acidified foods)",
      "Scheduled process on file",
      "pH testing every batch",
    ],
    source_url: "https://www.fda.gov/food/acidified-low-acid-canned-foods",
  },
  craft_supply: {
    id: "craft_supply",
    name: "Craft Supply (self-directed)",
    summary:
      "No food/drug regulatory framework applies. Include care/use instructions and any safety notes (mordants, dyestuffs).",
    label_required_fields: [
      "Product name",
      "Material content",
      "Care / use instructions",
      "Maker name",
    ],
    forbidden_patterns: [],
    disclaimer_required: false,
    facility_requirements: ["Safety data for mordants where applicable"],
  },
  seed_supply: {
    id: "seed_supply",
    name: "Seed Labeling Law",
    summary:
      "Seed packets must carry botanical name, lot number, germination rate, and test date. State + federal (USDA) seed law applies.",
    label_required_fields: [
      "Common + botanical name",
      "Lot number",
      "Germination rate (%)",
      "Test date",
      "Net count or weight",
      "Maker name & address",
    ],
    forbidden_patterns: [],
    disclaimer_required: false,
    facility_requirements: ["Germination testing within 12 months of sale"],
    source_url: "https://www.ams.usda.gov/rules-regulations/fsa",
  },
  self_regulated: {
    id: "self_regulated",
    name: "Self-Regulated (bulk / wholesale)",
    summary:
      "No prescribed consumer framework. Wholesale buyers typically expect a COA and lot traceability.",
    label_required_fields: ["Material name", "Lot number", "Net weight", "Maker name"],
    forbidden_patterns: [],
    disclaimer_required: false,
    facility_requirements: ["COA available on request"],
  },
  usda_organic: {
    id: "usda_organic",
    name: "USDA Organic (add-on)",
    summary:
      "Organic certification add-on. Certified handlers may use the seal; uncertified makers must avoid 'organic' label claims.",
    label_required_fields: ["Certifier name", "Certified-organic ingredient marks"],
    forbidden_patterns: ["\\bcertified organic\\b"],
    disclaimer_required: false,
    facility_requirements: ["Accredited certifier", "Organic system plan"],
    source_url: "https://www.ams.usda.gov/about-ams/programs-offices/national-organic-program",
  },
}

// ── Built-in pathway templates ──────────────────────────────────────────────

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

export function getTemplate(id: string): PathwayTemplate | undefined {
  return PATHWAY_TEMPLATES.find((t) => t.id === id)
}

// Map an output category to a display icon (used on pathway badges).
export function iconForOutput(category: ProductionPathway["output_category"]): string {
  const t = PATHWAY_TEMPLATES.find((t) => t.output_category === category)
  return t?.icon ?? "🌿"
}

// ── Label / status resolution ───────────────────────────────────────────────

export function getRunStatusLabel(pathway: ProductionPathway | undefined, status: RunStatus): string {
  return pathway?.production_status_labels?.[status] ?? DEFAULT_RUN_STATUS_LABELS[status]
}

export function getMaterialCategoryLabels(
  pathway: ProductionPathway | undefined
): Record<MaterialCategory, string> {
  return { ...DEFAULT_CATEGORY_LABELS, ...(pathway?.material_category_labels ?? {}) }
}

export function getMaterialCategoryLabel(
  pathway: ProductionPathway | undefined,
  category: MaterialCategory
): string {
  return getMaterialCategoryLabels(pathway)[category]
}

export function hasClaimRules(frameworkId: ComplianceFrameworkId): boolean {
  return (COMPLIANCE_FRAMEWORKS[frameworkId]?.forbidden_patterns.length ?? 0) > 0
}

// ── Compliance resolution + claim checking ──────────────────────────────────

const CONTEXT_NOTES: Record<ComplianceFrameworkId, string> = {
  fda_cosmetic: "FDA Cosmetic — INCI names required. No health claims.",
  fda_supplement: "FDA Supplement — structure/function claims only. Disclaimer required.",
  fda_food: "Food label — common names. List allergens. Net weight in oz or g.",
  fda_acidified_food: "Acidified food — pH below 4.6 required. Process filing + pH records.",
  craft_supply: "No regulatory framework required. Include care instructions if applicable.",
  seed_supply: "Include botanical name, lot #, germination rate, and test date.",
  self_regulated: "Wholesale — buyers expect a COA and lot traceability.",
  usda_organic: "Organic add-on — only certified handlers may use 'organic' claims.",
}

export function resolveCompliance(pathway: ProductionPathway): ResolvedCompliance {
  const framework = COMPLIANCE_FRAMEWORKS[pathway.compliance_framework_id]
  const merged = [
    ...framework.forbidden_patterns,
    ...(pathway.custom_forbidden_patterns ?? []),
  ]
  return {
    framework,
    label_required_fields: framework.label_required_fields,
    forbidden_patterns: merged,
    disclaimer_required: framework.disclaimer_required,
    context_note: CONTEXT_NOTES[pathway.compliance_framework_id],
  }
}

// Compile each forbidden pattern and flag matches. Invalid patterns are skipped
// (wrapped in try/catch) so a bad custom pattern never breaks the checker.
export function checkClaims(text: string, pathway: ProductionPathway): ClaimFlag[] {
  if (!text.trim()) return []
  const { forbidden_patterns } = resolveCompliance(pathway)
  const flags: ClaimFlag[] = []
  const seen = new Set<string>()

  for (const source of forbidden_patterns) {
    let re: RegExp
    try {
      re = new RegExp(source, "gi")
    } catch {
      continue // invalid pattern — skip rather than throw
    }
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      const phrase = m[0]
      const key = phrase.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      flags.push({
        flagged_phrase: phrase,
        reason: `"${phrase}" reads as a disease/drug claim, which isn't allowed under ${
          COMPLIANCE_FRAMEWORKS[pathway.compliance_framework_id].name
        }.`,
        suggestion: claimSuggestion(phrase),
      })
      if (m.index === re.lastIndex) re.lastIndex++ // avoid zero-width loop
    }
  }
  return flags
}

function claimSuggestion(phrase: string): string {
  const p = phrase.toLowerCase()
  if (p.startsWith("cure")) return "Describe the traditional use instead, e.g. 'traditionally used to support…'."
  if (p.startsWith("treat")) return "Avoid implying medical treatment; describe the experience or tradition."
  if (p.startsWith("heal")) return "Use 'soothing' or 'nourishing' rather than 'healing'."
  if (p.startsWith("prevent")) return "Remove the prevention claim; state the ingredient and its traditional role."
  return "Reframe as a structure/function or sensory statement, not a disease claim."
}

// ── Batch numbers ───────────────────────────────────────────────────────────
// Fixed format: [PREFIX-]YYYYMMDD-NNN. Prefix is pathway-configurable.

export function formatBatchNumber(prefix: string | undefined, date: Date, seq: number): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  const n = String(seq).padStart(3, "0")
  const stem = `${y}${m}${d}-${n}`
  return prefix ? `${prefix}-${stem}` : stem
}
