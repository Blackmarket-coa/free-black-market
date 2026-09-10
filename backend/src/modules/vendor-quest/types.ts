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
export type DomainFieldKey =
  | "inventory"
  | "production"
  | "channels"
  | "documents"
  | "funds"
  | "permits"

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
  /**
   * Orders on the seller's `seller_order` link whose `fulfillment_status` is
   * `fulfilled`, `shipped` or `delivered` and that were not canceled
   * (`substrate/operating.ts`).
   */
  orders_fulfilled: number
  /**
   * 0..1: fulfilled ÷ decided, where a decided order is fulfilled, canceled, or
   * left unfulfilled past `STALE_UNFULFILLED_DAYS`. Null under
   * `RELIABILITY_MIN_SAMPLE` decided orders — not enough history — which the
   * `fulfillmentReliabilityAtLeast` predicate reads as "not proven".
   */
  fulfillment_reliability: number | null
}

export interface CustomerRecord {
  distinct_customers: number
  repeat_customers: number
  repeat_rate: number | null
  /** Distinct customers across the seller's active `WHOLESALE` tiers (`vendor-rules`). */
  wholesale_relationships: number
}

export interface ReputationSummary {
  trust_score: number | null // 0..100
  tier: string | null
  /** Lifetime `total_xp` summed over the seller's members' character sheets (`progression`). */
  total_xp: number
  /** Live (`open` / `under_review`) `order-dispute` cases against the seller. */
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

/**
 * A snapshot of `fund-accounting`'s derived portfolio — restricted grants and
 * the funds a sponsored project reports on.
 *
 * Copied, never re-summed. `getPortfolioReport` derives every figure from
 * `fund_transaction` rows on each call, so a fund can never disagree with its
 * own history; re-adding cents here would invent a second source of truth.
 * `violation_count` carries whether the ledger already disagrees with the
 * grantor's intent, without dragging the violation detail into the substrate.
 */
export interface FundsSummary {
  fund_count: number
  /** Closed funds included — the portfolio report does not filter by status. */
  currency_code: string
  awarded_cents: number
  received_cents: number
  spent_cents: number
  cash_available_cents: number
  /** Compliance breaks across the portfolio; 0 when the ledger is clean. */
  violation_count: number
}

/** One self-declared credential's standing, copied from `cottage-food`. */
export interface PermitStanding {
  /** `cottage-food`'s own `ExpiryStatus`, carried through unchanged. */
  status: "unset" | "ok" | "expiring_soon" | "expired"
  expires_at: string | null
  /** Whole days remaining; negative once past. Copied, never recomputed. */
  days_until: number | null
}

/**
 * A snapshot of `cottage-food`'s compliance profile — the permit and
 * food-handler dates a home-based food seller declared about themselves.
 *
 * SELF-DECLARED, AND THAT IS THE WHOLE POINT. `cottage-food`'s governing rule
 * is that "the seller is the authority on their own compliance; FBM's job is
 * to count accurately and show them the number" — the platform ships no
 * state-law table and makes no legal determination about anyone's operation.
 * Nothing reading this field may present it as FBM certifying compliance, and
 * nothing may treat it as a block: that module "never blocks a sale", and a
 * substrate snapshot of it does not get to be stricter than its source.
 *
 * What a requirement reading this can honestly say is "you told us this date,
 * and it has passed" — which is worth saying, and is exactly what nothing said
 * before.
 *
 * Copied, never recomputed — the `funds` rule. `getComplianceSnapshot` derives
 * `status` and `days_until` from the stored dates on every call, so
 * recomputing them here would invent a second source of truth that could
 * disagree with the compliance dashboard the vendor is looking at.
 */
export interface PermitsSummary {
  /** What the seller said they run, e.g. "cottage_food". Null when unset. */
  operation_type: string | null
  permit: PermitStanding
  food_handler: PermitStanding
  /**
   * How many plain-language notes the module raised. A count, not the text:
   * the advisories are sentences written for a human to read, and dragging
   * them into the substrate would invite a predicate to match on their wording.
   */
  advisory_count: number
}

/**
 * Present only on an AGGREGATE substrate (a collective quest's combined record).
 * `null` for an individual vendor. Collective quest definitions read
 * `s.collective?.member_count`; individual quests ignore it — so the engine
 * stays generic and this behaves like any other domain-optional field.
 */
export interface CollectiveAggregateInfo {
  member_count: number
  member_ids: string[]
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
  funds: FundsSummary | null
  permits: PermitsSummary | null
  /** Null for individual vendors; populated when this is an aggregate. */
  collective: CollectiveAggregateInfo | null
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
  /** For collective quests: substrate scopes a member must consent to before
   *  their record may be aggregated. A member is included ONLY if they consent
   *  to every scope here (never aggregate data a member didn't consent to). */
  requiredConsentScopes?: string[]
  /**
   * When true, this quest's full requirement list is published to the
   * unauthenticated `GET /store/quest-catalog`, requirement notes included,
   * rather than only its counts.
   *
   * Quests are gated on `FF_VENDOR_QUESTS_V1` plus the `vendor.quests` plan
   * feature, which the Scale plan and the quest-pack add-on grant. For a
   * capital-readiness quest that is defensible pricing. For a checklist whose
   * function is to stop somebody disturbing asbestos in a 1950s building, it
   * puts safety content behind a paywall — and a person who cannot afford the
   * plan is not thereby less likely to cut into a wall.
   *
   * The exemption is deliberately narrow, and it is not a change to who may
   * *enrol*. Enrolment, progress tracking and packet export stay gated exactly
   * as before; what becomes free is the content — which documents are needed,
   * which rules apply, and which regulator to call. That is the part whose
   * absence hurts someone. Leaving the pricing of the tracked experience
   * alone also keeps this out of a revenue decision that is the operator's.
   *
   * docs/TRANSMUTATION_STRATEGY.md §4.4.
   */
  safetyCritical?: boolean
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
