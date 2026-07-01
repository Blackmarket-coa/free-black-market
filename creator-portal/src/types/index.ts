// Shared domain types for the FBM creator portal.
// These mirror the shapes the FBM backend returns (creator-program /
// hawala-ledger / subscription / marketplace-webhooks Blackout bridge). While
// the creator-hub read routes are wired they are satisfied by the typed mock
// layer in src/lib/mock; the live bridge mutations (stream overlay, membership
// force-resync) hit the real backend — see hooks/useCreatorData.ts.

// Canonical KARMA tier ladder lives in @bmc/portal-kit; import for local use
// and re-export so existing `import type { TierKey } from "@/types"` sites resolve.
import type { TierKey } from "@bmc/portal-kit"
export type { TierKey }

// ---- Memberships -----------------------------------------------------------
export type MemberStatus = "active" | "paused" | "past_due" | "cancelled" | "expired"

// Whether the member's FBM tier matches their Blackout Space room membership.
export type SyncStatus = "in_sync" | "drift" | "no_mxid"

export interface MembershipTier {
  id: string
  name: string
  price_amount: number
  interval: "monthly" | "yearly"
  blackout_tier: "signal" | "signal_plus" | "community"
  credits_per_period: number
  perks: string[]
  active_members: number
}

export interface Member {
  id: string
  name?: string | null
  email: string
  tier_name: string
  status: MemberStatus
  started_at: string
  next_renewal_at?: string | null
  ltv_amount: number
  // Blackout Space ACL sync state (Phase 1 membership bridge).
  matrix_id?: string | null
  sync_status: SyncStatus
}

// ---- Coalition Credits (₡, CCR rail) + XP ---------------------------------
export interface CreditBalance {
  available_credits: number // spendable / withdrawable
  pending_credits: number // in Stellar escrow (Refrain bounties)
  lifetime_earned: number // all-time total earned
}

export type CreditTxnType =
  | "tip"
  | "membership"
  | "boost"
  | "withdrawal"
  | "xp_conversion"
  | "dead_drop"
  | "platform_fee"

export interface CreditTransaction {
  id: string
  type: CreditTxnType
  amount_credits: number // signed: + earned, - spent/withdrawn
  counterparty?: string | null
  room?: string | null
  created_at: string
  blackout_event_id?: string | null
}

// XP balances are per-Space (coalition), never aggregated across Spaces.
export interface XpBalance {
  space_id: string
  space_name: string
  xp: number
}

// ---- Governance Boosts -----------------------------------------------------
export type BoostType = "hype_train" | "fundraiser_rally" | "proposal_boost" | "bounty_boost"
export type BoostStatus = "active" | "succeeded" | "expired"

export interface BoostMilestone {
  credits: number
  reward: string
  unlocked: boolean
}

export interface Boost {
  id: string
  type: BoostType
  title: string
  status: BoostStatus
  goal_credits: number
  current_credits: number
  contributor_count: number
  milestones: BoostMilestone[]
  ends_at: string
  linked_product_name?: string | null
  matrix_state_event_id?: string | null
}

// ---- Smart Split contracts -------------------------------------------------
export type SplitStatus = "draft" | "active" | "archived"

export interface SplitParty {
  name: string
  matrix_id?: string | null
  pct: number
  is_creator?: boolean
}

export interface SplitContract {
  id: string
  name: string
  status: SplitStatus
  parties: SplitParty[]
  created_at: string
  activated_at?: string | null
  // The canonical proof, set once activation writes the Matrix state event.
  matrix_event_id?: string | null
  space_id?: string | null
}

// ---- Stream overlay --------------------------------------------------------
export interface OverlayUrlResponse {
  overlay_url: string
  expires_at: string
  instructions: string
}

// ---- Payouts ---------------------------------------------------------------
export interface PayoutRecord {
  id: string
  month: string // "2026-05"
  gross_cents: number
  fee_cents: number
  net_cents: number
  paid_at?: string | null
  transfer_ref?: string | null
}

export interface RevenueByType {
  type: "Memberships" | "Tips" | "Boosts" | "Dead-drops" | "Splits"
  gross_cents: number
  net_cents: number
}

export interface PayoutsData {
  current_period: {
    by_type: RevenueByType[]
    net_total_cents: number
    next_payment_date: string
  }
  tier: TierKey
  karma_total: number
  history: PayoutRecord[]
  earnings_ytd_cents: number
  w9_required: boolean
}

// ---- Dashboard pulse -------------------------------------------------------
export type UrgentActionType =
  | "boost"
  | "refrain"
  | "membership"
  | "split"
  | "message"
  | "payout"

export interface UrgentAction {
  type: UrgentActionType
  message: string
  count?: number
  link: string
}

export interface SpaceHealth {
  weekly_active_members_pct: number
  governance_participation_pct: number
  messages_per_room_avg: number
  retention_30d_pct: number
}

export interface RefrainQueue {
  pending_review: number
  awaiting_delivery: number
  in_revision: number
}

export interface DashboardSummary {
  credits_earned_today: number
  new_members_today: number
  unread_dms: number
  mrr_change_this_week_cents: number
  active_boost: Boost | null
  refrain_queue: RefrainQueue
  space_health: SpaceHealth
  urgent_actions: UrgentAction[]
  recent_activity: BlackoutMessage[]
  quest_highlights: QuestHighlight[]
}

// ---- Blackout (Matrix) -----------------------------------------------------
export type BlackoutMessageType =
  | "tip"
  | "membership"
  | "boost"
  | "system"
  | "text"

export interface BlackoutMessage {
  id: string
  type: BlackoutMessageType
  text: string
  sender?: string
  timestamp: string // ISO
  link?: string
}

export interface MemberThread {
  room_id: string
  member_name: string
  last_message: string
  timestamp: string
  unread: number
  tier_name?: string | null
}

// ---- Analytics -------------------------------------------------------------
export interface AnalyticsData {
  revenue_by_type: Array<Record<string, number | string>>
  mrr_trend: Array<{ month: string; mrr_cents: number }>
  members_growth: Array<{ month: string; new_members: number; churned_members: number }>
  credits_flow: Array<{ week: string; tips_credits: number; boosts_credits: number }>
  top_supporters: Array<{ name: string; credits: number }>
  insights: string[]
}

// ---- Embed -----------------------------------------------------------------
export interface EmbedOffering {
  id: string
  name: string
  embedded: boolean
}

export interface EmbedConfig {
  masked_key: string | null
  snippet: string
  theme: "warm" | "forest" | "minimal" | "dark"
  embeddable: {
    memberships: EmbedOffering[]
    products: EmbedOffering[]
  }
  analytics: {
    views: number
    clicks: number
    purchases: number
    conversion_pct: number
  }
}

// ---- Quests ----------------------------------------------------------------
export interface QuestHighlight {
  quest_title: string
  current: number
  required: number
  karma_reward: number
}

// ---- Governance (shared component contract) --------------------------------
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
