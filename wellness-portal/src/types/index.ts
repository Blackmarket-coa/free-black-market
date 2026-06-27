// Shared domain types for the wellness practitioner portal.
// These mirror the shapes the FBM backend (src/modules/wellness) returns; for
// now they are satisfied by the typed mock layer in src/lib/mock.

export type TierKey = "seedling" | "sprout" | "root" | "canopy" | "ancestor"

// ---- Sessions (1:1) --------------------------------------------------------
export type SessionLocationType = "video" | "in_person" | "phone" | "either"

export type Modality =
  | "Reiki"
  | "Energy Work"
  | "Sound Healing"
  | "Coaching"
  | "Breathwork"
  | "Reading"
  | "Astrology"
  | "Other"

export interface SessionType {
  id: string
  name: string
  description?: string | null
  duration_minutes: number
  buffer_minutes: number
  price_amount: number | null
  currency_code?: string | null
  location_type: SessionLocationType
  modality?: Modality
  intake_form_id?: string | null
  is_active: boolean
  is_embeddable: boolean
  bookings_this_month?: number
}

export type BookingStatus =
  | "pending"
  | "confirmed"
  | "completed"
  | "cancelled"
  | "no_show"

export interface Booking {
  id: string
  client_name: string
  client_email: string
  session_type_name: string
  starts_at: string // ISO
  ends_at: string // ISO
  duration_minutes: number
  status: BookingStatus
  delivery: "virtual" | "in_person"
  intake_received?: boolean
  intake_required?: boolean
  matrix_room_id?: string | null
}

// ---- Classes ---------------------------------------------------------------
export type ClassStatus = "scheduled" | "open" | "full" | "cancelled" | "completed"

export interface ClassEvent {
  id: string
  title: string
  description?: string | null
  starts_at: string
  ends_at: string
  capacity: number
  seats_taken: number
  waitlist_count?: number
  price_amount: number | null
  location_type: "video" | "in_person" | "hybrid"
  status: ClassStatus
  recording_url?: string | null
}

export interface ClassAttendee {
  id: string
  customer_name?: string | null
  customer_email: string
  status: "registered" | "waitlisted" | "attended" | "no_show" | "cancelled"
  intake_received?: boolean
  purchased_at?: string
}

// ---- Digital + physical products ------------------------------------------
export interface DigitalProduct {
  id: string
  name: string
  type: "single" | "course" | "bundle" | "deck"
  price_amount: number | null
  total_sales: number
  download_count: number
  status: "public" | "draft"
}

export interface PhysicalProduct {
  id: string
  name: string
  category: string
  sku: string
  stock: number
  price_amount: number
  sales_per_month?: number
  status: "active" | "archived"
  bmc_sourced?: boolean
}

// ---- Memberships -----------------------------------------------------------
export type MemberStatus = "active" | "paused" | "past_due" | "cancelled" | "expired"

export interface MembershipTier {
  id: string
  name: string
  price_amount: number
  interval: "monthly" | "yearly"
  credits_per_period: number
  discount_pct: number
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
  credits_balance: number
  ltv_amount: number
}

// ---- Client CRM ------------------------------------------------------------
export interface ClientProfile {
  id: string
  name?: string | null
  email: string
  phone?: string | null
  tier_name?: string | null
  tags?: string[]
  total_bookings: number
  lifetime_value_amount: number
  last_seen_at?: string | null
  no_show_count?: number
}

export interface ClientNote {
  id: string
  body: string
  is_private: boolean
  created_at: string
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
  type: "Sessions" | "Classes" | "Digital" | "Physical" | "Memberships"
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

// ---- Dashboard -------------------------------------------------------------
export type UrgentActionType =
  | "booking"
  | "intake"
  | "membership"
  | "delivery"
  | "message"
  | "quest"

export interface UrgentAction {
  type: UrgentActionType
  message: string
  count?: number
  link: string
}

export interface RevenueSnapshot {
  sessions_cents: number
  classes_cents: number
  digital_cents: number
  physical_cents: number
  memberships_cents: number
  total_cents: number
  last_month_total_cents: number
}

export interface WeekDay {
  date: string // ISO date
  session_count: number
  class_count: number
  revenue_cents: number
}

export interface QuestHighlight {
  quest_title: string
  current: number
  required: number
  karma_reward: number
}

export interface DashboardSummary {
  todays_agenda: Booking[]
  urgent_actions: UrgentAction[]
  week: WeekDay[]
  revenue: RevenueSnapshot
  recent_clients: ClientProfile[]
  next_class?: ClassEvent | null
  quest_highlights: QuestHighlight[]
}

// ---- Blackout (Matrix) -----------------------------------------------------
export type BlackoutMessageType = "client" | "booking" | "membership" | "system" | "text"

export interface BlackoutMessage {
  id: string
  type: BlackoutMessageType
  text: string
  sender?: string
  timestamp: string // ISO
  link?: string
}

export interface ClientThread {
  room_id: string
  client_name: string
  last_message: string
  timestamp: string
  unread: number
  upcoming_session_at?: string | null
}

export type AutomationTrigger =
  | "booking_confirmed"
  | "booking_reminder_24h"
  | "booking_reminder_1h"
  | "booking_completed"
  | "no_show"
  | "class_registered"
  | "class_reminder"
  | "recording_available"
  | "membership_welcome"
  | "membership_renewed"
  | "credits_low"
  | "reengagement"

export interface AutomationTemplate {
  id: string
  trigger: AutomationTrigger
  name: string
  body: string
  enabled: boolean
}

// ---- Analytics -------------------------------------------------------------
export interface AnalyticsData {
  revenue_by_type: Array<Record<string, number | string>>
  booking_rate: Array<{ week: string; available_hours: number; booked_hours: number }>
  retention: Array<{ month: string; new_clients: number; returning_clients: number }>
  session_performance: Array<{ name: string; sessions: number; revenue_cents: number }>
  class_fill: Array<{ name: string; capacity: number; attendees: number }>
  mrr_trend: Array<{ month: string; mrr_cents: number }>
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
    session_types: EmbedOffering[]
    classes: EmbedOffering[]
  }
  analytics: {
    views: number
    clicks: number
    purchases: number
    conversion_pct: number
  }
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
