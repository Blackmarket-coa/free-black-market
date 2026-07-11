// Shared domain types for the nursery portal.
// These mirror the shapes the FBM backend will eventually return; for now they
// are satisfied by the typed mock layer in src/lib/mock.

export type Role = "hub" | "node"

// Canonical KARMA tier ladder lives in @bmc/portal-kit; import for local use
// and re-export so existing `import type { TierKey } from "@/types"` sites resolve.
import type { TierKey } from "@bmc/portal-kit"
export type { TierKey }

export type PropagationMethod =
  | "seed"
  | "cutting"
  | "plug"
  | "bareroot"
  | "division"
  | "airlayer"
  | "layering"
  | "graft"
  | "offset"

// Status machine — transitions only move forward.
export type BatchStatus =
  | "started"
  | "germinating"
  | "rooting"
  | "growing_out"
  | "ready"
  | "listed"
  | "sold_out"
  | "failed"

export interface PropagationBatch {
  id: string
  species_name: string
  method: PropagationMethod
  status: BatchStatus
  qty_started: number
  qty_successful: number
  started_at: string // ISO
  expected_ready_at: string // ISO
  pot_size?: string
  is_rare_species?: boolean
  hub_requested?: boolean
  photo_url?: string | null
  photo_verified_at?: string | null
  notes?: string
}

export interface StratificationRecord {
  id: string
  species_name: string
  type: string // e.g. "cold moist"
  start_at: string
  duration_days: number
  end_at: string
  location?: string
}

export interface MotherPlant {
  id: string
  species_name: string
  location: string
  last_harvest_at?: string | null
  next_harvest_window?: string
  estimated_yield?: number
}

export interface InventoryItem {
  id: string
  species_name: string
  method: PropagationMethod
  quantity: number
  pot_size?: string
  age_label?: string
  days_in_stock?: number
}

export type OrderFulfillmentStatus =
  | "unfulfilled"
  | "label_requested"
  | "label_ready"
  | "packed"
  | "shipped"

export interface OrderLine {
  species_name: string
  qty: number
}

export interface NurseryOrder {
  id: string
  buyer_name: string
  lines: OrderLine[]
  destination_state: string // 2-letter
  ship_by: string // ISO
  status: OrderFulfillmentStatus
  total_cents: number
  tracking_number?: string | null
  created_at: string
}

export interface DoaClaim {
  id: string
  order_id: string
  species_name: string
  buyer_reason: string
  opened_at: string
  status: "open" | "resolved"
}

export type UrgentActionType =
  | "orders"
  | "inventory"
  | "seasonal"
  | "quest"
  | "compliance"

export interface UrgentAction {
  type: UrgentActionType
  message: string
  count?: number
  link: string
}

export interface SeasonalAlert {
  action: string
  species: string
  urgency: "high" | "med" | "low"
}

export interface QuestHighlight {
  quest_title: string
  current: number
  required: number
  karma_reward: number
}

export interface NodeHealth {
  node_id: string
  name: string
  state: string
  tier: TierKey
  units_this_month: number
  pending_fulfillments: number
  health: "green" | "yellow" | "red"
}

export interface DashboardSummary {
  urgent_actions: UrgentAction[]
  todays_metrics: {
    orders_pending: number
    units_in_propagation: number
    active_listings: number
    month_earnings_cents: number
  }
  propagation_batches: PropagationBatch[]
  recent_orders: NurseryOrder[]
  seasonal_alerts: SeasonalAlert[]
  blackout_preview: BlackoutMessage[]
  quest_highlights: QuestHighlight[]
  // hub only
  network_health?: NodeHealth[]
}

export interface KarmaEvent {
  id: string
  type: string
  karma: number
  at: string
  description: string
}

export interface PayoutRecord {
  id: string
  month: string // "2026-05"
  units_sold: number
  gross_cents: number
  split_pct: number
  net_cents: number
  paid_at?: string | null
  transfer_ref?: string | null
}

export interface SplitLine {
  product_name: string
  units: number
  gross_cents: number
  your_cut_cents: number
}

export interface PayoutsData {
  current_period: {
    units_sold: number
    gross_cents: number
    split_pct: number
    net_cents: number
    next_payment_date: string
  }
  tier: TierKey
  karma_total: number
  karma_events: KarmaEvent[]
  history: PayoutRecord[]
  split_breakdown: SplitLine[]
  earnings_ytd_cents: number
  w9_required: boolean
}

export type BlackoutMessageType =
  | "order"
  | "label"
  | "photo"
  | "payout"
  | "low_stock"
  | "cert"
  | "text"

export interface BlackoutMessage {
  id: string
  type: BlackoutMessageType
  text: string
  sender?: string
  timestamp: string // ISO
  // optional payloads for rich rendering
  order_id?: string
  download_url?: string
  link?: string
}

export interface GovernanceProposal {
  id: string
  title: string
  description: string
  options: string[]
  deadline: string
  tally: Record<string, number>
  status: "open" | "closed"
  outcome?: string
}

// ── Listings & Order Cycles ─────────────────────────────────────────────────

export type ListingStatus = "active" | "paused" | "sold_out"

export interface NurseryListing {
  id: string
  species_name: string
  category: string // e.g. "Fruit & nut", "Herbs", "Natives"
  pot_size: string
  price_cents: number
  stock: number
  status: ListingStatus
  orders_30d?: number
}

export type OrderCycleStatus = "upcoming" | "open" | "fulfilling" | "closed"

export interface OrderCycle {
  id: string
  name: string
  opens_at: string // ISO
  closes_at: string // ISO
  status: OrderCycleStatus
  order_count: number
  gross_cents: number
}

export interface DemandPoolSpecies {
  id: string
  species_name: string
  requests: number
  top_states: string[]
  suggested_method: PropagationMethod
  activated: boolean
}

export interface ListingsData {
  listings: NurseryListing[]
  order_cycles: OrderCycle[]
  demand_pool: DemandPoolSpecies[]
}

// ── Analytics ───────────────────────────────────────────────────────────────

export interface RevenuePoint {
  month: string // "2026-05"
  gross_cents: number
  net_cents: number
  fees_cents: number
  units: number
}

export interface MethodSuccessRate {
  method: PropagationMethod
  batches: number
  qty_started: number
  qty_successful: number
}

export interface SpeciesPerformance {
  species_name: string
  units: number
  revenue_cents: number
  avg_price_cents: number
  doa_count: number
}

export interface StateSales {
  state: string // 2-letter
  units: number
}

export interface AnalyticsSummary {
  revenue_by_month: RevenuePoint[]
  method_success: MethodSuccessRate[]
  top_species: SpeciesPerformance[]
  sales_by_state: StateSales[]
  doa_rate_trend: { month: string; rate: number }[] // rate 0..1
}

// ── Wholesale (hub only) ────────────────────────────────────────────────────

export interface WholesalePriceRow {
  id: string
  species_name: string
  format: string // e.g. "72-cell plug tray"
  unit_price_cents: number
  min_order_qty: number
  available_qty: number
  lead_time_weeks: number
}

export type WholesaleRequestStatus = "new" | "quoted" | "accepted" | "declined"

export interface WholesaleBuyerRequest {
  id: string
  buyer_name: string
  org_type: string // e.g. "Restoration contractor", "Garden center"
  species_name: string
  qty: number
  state: string
  requested_at: string
  status: WholesaleRequestStatus
  notes?: string
}

export interface WholesaleData {
  price_sheet: WholesalePriceRow[]
  buyer_requests: WholesaleBuyerRequest[]
}

// ── Network (hub only) ──────────────────────────────────────────────────────

export type NodeTransferStatus = "requested" | "in_transit" | "received"

export interface NodeTransfer {
  id: string
  from_node: string
  to_node: string
  species_name: string
  qty: number
  status: NodeTransferStatus
  updated_at: string
}

export type NodeApplicationStage = "applied" | "interview" | "trial_batch" | "approved"

export interface NodeApplication {
  id: string
  applicant_name: string
  state: string
  stage: NodeApplicationStage
  applied_at: string
}

export interface NetworkData {
  totals: {
    units_this_month: number
    gross_cents: number
    grower_pool_cents: number
    hub_net_cents: number
  }
  nodes: NodeHealth[]
  transfers: NodeTransfer[]
  onboarding: NodeApplication[]
}

// ── Quests ──────────────────────────────────────────────────────────────────
// These mirror the backend vendor-quest module responses exactly:
//   GET  /vendor/quests             → { quests: QuestCatalogEntry[], count }
//   GET  /vendor/quests/enrollments → { enrollments: QuestEnrollmentItem[], count }
// (see backend/src/modules/vendor-quest/types.ts and service.ts toCatalogEntry)

export type QuestRequirementTag =
  | "platform" // 🟢 FBM generates it from real records
  | "assisted" // 🟡 FBM drafts it from records + vendor input
  | "vendor-supplied" // ⚪ vendor uploads it
  | "outside-fbm" // ❌ lives outside FBM entirely

export type QuestDomainField = "inventory" | "production" | "channels" | "documents"

export interface QuestCatalogRequirement {
  key: string
  label: string
  tag: QuestRequirementTag
  needs: QuestDomainField[]
  note?: string
}

export interface QuestCatalogStage {
  key: string
  label: string
  order: number
  description?: string
}

export interface QuestCatalogEntry {
  key: string
  category: string
  title: string
  outcome: string
  type: "individual" | "collective"
  gatekeeper: string
  disclaimer: string
  health_claims_guardrail: boolean
  uses_fields: QuestDomainField[]
  has_packet: boolean
  requirements: QuestCatalogRequirement[]
  stages: QuestCatalogStage[]
}

export type QuestEnrollmentStatus = "ACTIVE" | "DROPPED" | "COMPLETE"

export interface QuestEnrollment {
  id: string
  seller_id: string
  quest_key: string
  status: QuestEnrollmentStatus
  current_stage: number
  collective_id: string | null
  enrolled_at: string
  dropped_at: string | null
  completed_at: string | null
}

export type QuestRequirementStatus =
  | "satisfied"
  | "unsatisfied"
  | "unavailable" // a needed domain field is absent for this vendor
  | "checklist" // vendor-supplied / outside-fbm, never auto-satisfied

export interface QuestEvaluatedRequirement {
  key: string
  label: string
  tag: QuestRequirementTag
  status: QuestRequirementStatus
  note?: string
}

export interface QuestEvaluatedStage {
  key: string
  label: string
  order: number
  open: boolean
  missing: string[]
}

export interface QuestEvaluation {
  quest_key: string
  stages: QuestEvaluatedStage[]
  current_stage_index: number
  current_stage_key: string | null
  final_gate_open: boolean
  packet_available: boolean
  requirements: QuestEvaluatedRequirement[]
}

/** One row of GET /vendor/quests/enrollments — evaluation is null unless ACTIVE. */
export interface QuestEnrollmentItem {
  enrollment: QuestEnrollment
  evaluation: QuestEvaluation | null
}
