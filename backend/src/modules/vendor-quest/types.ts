/**
 * Vendor Quest Engine — shared contracts.
 *
 * These types are the boundary between the GENERIC engine and per-quest CONFIG.
 * The engine (`engine.ts`, `service.ts`) never references a specific quest key,
 * vendor vertical, or physical-goods concept — it operates purely on these
 * shapes. Adding a quest = writing a new `QuestDefinition`, never editing the
 * engine.
 */

// ────────────────────────────────────────────────────────────────────────────
// Substrate — the one vendor operating record every quest queries.
//
// It has two layers so it fits ANY vendor, not just physical-goods sellers:
//   • Universal fields are ALWAYS present (revenue, operating history,
//     customers, reputation) — every vendor accrues them passively.
//   • Domain-optional fields are `| null` and only populated when relevant
//     (inventory, production, channels, documents). A service / digital /
//     practitioner vendor has these as `null` and is a first-class citizen.
// ────────────────────────────────────────────────────────────────────────────

/** Domain-optional substrate field keys (the nullable ones). */
export type DomainFieldKey = "inventory" | "production" | "channels" | "documents"

export interface RevenueSummary {
  currency: string
  /** Lifetime revenue in major units (dollars), from the settlement ledger. */
  lifetime_revenue: number
  last_30d_revenue: number
  avg_daily_revenue: number
  /** Monthly buckets → cash-flow & seasonality. */
  monthly: { month: string; revenue: number }[]
  /** Provenance string; every figure must trace to real ledger transactions. */
  source: string
}

export interface OperatingHistory {
  account_created_at: string | null
  account_age_days: number
  months_active: number
  listing_count: number
  orders_fulfilled: number
  /** 0..1, or null when there is not enough history to compute it. */
  fulfillment_reliability: number | null
}

export interface CustomerRecord {
  distinct_customers: number
  repeat_customers: number
  repeat_rate: number | null
  wholesale_relationships: number
}

export interface ReputationSummary {
  trust_score: number | null // 0..100
  tier: string | null
  total_xp: number
  dispute_count: number
  /** Only reflects credentials a human actually verified (never fabricated). */
  verified_credentials: number
}

export interface InventoryValuation {
  on_hand_units: number
  retail_value: number
  cost_value: number | null
}

export interface ProductionSummary {
  batch_count: number
  total_started: number
  total_yield: number
  methods: string[]
}

export interface ChannelSummary {
  channels: { key: string; label: string }[]
}

export interface VaultSummary {
  documents: {
    id: string
    doc_type: string
    label: string
    verified: boolean
    expires_at: string | null
  }[]
}

export interface VendorSubstrate {
  seller_id: string
  generated_at: string
  // Universal — always present.
  revenue: RevenueSummary
  operating: OperatingHistory
  customers: CustomerRecord
  reputation: ReputationSummary
  // Domain-optional — null when the vendor/module isn't present.
  inventory: InventoryValuation | null
  production: ProductionSummary | null
  channels: ChannelSummary | null
  documents: VaultSummary | null
}

// ────────────────────────────────────────────────────────────────────────────
// Quest definition — pure config over the substrate.
// ────────────────────────────────────────────────────────────────────────────

/**
 * How a requirement is satisfied, mirroring the catalog legend:
 *   platform       🟢 FBM generates it from real records
 *   assisted       🟡 FBM drafts/assembles it from records + vendor input
 *   vendor-supplied ⚪ vendor uploads it; FBM stores it (document vault)
 *   outside-fbm    ❌ lives outside FBM entirely (checklist + links only)
 */
export type RequirementTag =
  | "platform"
  | "assisted"
  | "vendor-supplied"
  | "outside-fbm"

export interface QuestRequirement {
  key: string
  label: string
  tag: RequirementTag
  /** Domain fields this requirement reads; if any is null it is "unavailable". */
  needs?: DomainFieldKey[]
  /**
   * For platform/assisted requirements: does the substrate satisfy it? Omitted
   * for vendor-supplied / outside-fbm (those are checklist items, never
   * auto-satisfied — FBM must not fabricate them).
   */
  satisfied?: (s: VendorSubstrate) => boolean
  note?: string
}

export interface StageGate {
  key: string
  label: string
  order: number
  description?: string
  /** Pure predicate: does the vendor's substrate open this gate? */
  unlocks: (s: VendorSubstrate) => boolean
  /** Human-readable list of what is still missing to open this gate. */
  missing: (s: VendorSubstrate) => string[]
}

export interface PacketSectionResult {
  available: boolean
  data: unknown
  note?: string
}

export interface PacketSection {
  key: string
  title: string
  /** Builds one section from the substrate; marks itself unavailable if a
   *  needed domain field was absent (graceful degradation). */
  build: (s: VendorSubstrate) => PacketSectionResult
}

export interface PacketTemplate {
  key: string
  title: string
  sections: PacketSection[]
  /** Items the gatekeeper still needs that FBM cannot produce (checklist). */
  remainingItems: (s: VendorSubstrate) => string[]
}

export interface Gatekeeper {
  name: string
  /** Honest-UI disclaimer shown on every quest surface and in the packet. */
  disclaimer: string
  links: { label: string; url: string }[]
}

export interface QuestDefinition {
  key: string
  category: string
  title: string
  outcome: string
  type: "individual" | "collective"
  gatekeeper: Gatekeeper
  requirements: QuestRequirement[]
  stageGates: StageGate[]
  /** Null for internal-unlock quests (Q10 trust tier, Q13 commons). */
  packetTemplate: PacketTemplate | null
  /** Domain-optional fields this quest can use (drives the "what it needs" UI). */
  usesFields: DomainFieldKey[]
  /** When true, packet/tier copy reflects verified credentials ONLY and never
   *  implies clinical/medical authority (wellness health-claims guardrail). */
  healthClaimsGuardrail?: boolean
}

// ────────────────────────────────────────────────────────────────────────────
// Engine output.
// ────────────────────────────────────────────────────────────────────────────

export type RequirementStatus =
  | "satisfied"
  | "unsatisfied"
  | "unavailable" // a needed domain field is absent
  | "checklist" // vendor-supplied / outside-fbm

export interface EvaluatedRequirement {
  key: string
  label: string
  tag: RequirementTag
  status: RequirementStatus
  note?: string
}

export interface EvaluatedStage {
  key: string
  label: string
  order: number
  open: boolean
  missing: string[]
}

export interface QuestEvaluation {
  quest_key: string
  stages: EvaluatedStage[]
  /** Count of leading gates passed (contiguous from the first). */
  current_stage_index: number
  current_stage_key: string | null
  final_gate_open: boolean
  packet_available: boolean
  requirements: EvaluatedRequirement[]
}
