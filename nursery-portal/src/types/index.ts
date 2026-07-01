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
