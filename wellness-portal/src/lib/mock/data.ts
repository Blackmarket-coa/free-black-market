// Typed mock layer for the wellness portal. While the FBM wellness backend
// routes are wired, hooks resolve from here (USE_MOCK_DATA in lib/api.ts).
// Dates are anchored around late June 2026 so the calendar/dashboard look live.
import type {
  AnalyticsData,
  AutomationTemplate,
  Booking,
  BlackoutMessage,
  ClassAttendee,
  ClassEvent,
  ClientProfile,
  ClientThread,
  DashboardSummary,
  DigitalProduct,
  EmbedConfig,
  Member,
  MembershipTier,
  PayoutsData,
  PhysicalProduct,
  SessionType,
} from "@/types"

export const MOCK_SESSION_TYPES: SessionType[] = [
  {
    id: "st_reiki60",
    name: "60-Minute Reiki Session",
    description: "Hands-on energy balancing to clear and align your field.",
    duration_minutes: 60,
    buffer_minutes: 15,
    price_amount: 12000,
    currency_code: "usd",
    location_type: "either",
    modality: "Reiki",
    is_active: true,
    is_embeddable: true,
    bookings_this_month: 14,
  },
  {
    id: "st_sound45",
    name: "Sound Healing Journey",
    description: "Crystal bowls + voice for deep nervous-system reset.",
    duration_minutes: 45,
    buffer_minutes: 15,
    price_amount: 9000,
    currency_code: "usd",
    location_type: "in_person",
    modality: "Sound Healing",
    is_active: true,
    is_embeddable: true,
    bookings_this_month: 8,
  },
  {
    id: "st_coach30",
    name: "Intuitive Coaching (30 min)",
    description: "Focused guidance session, virtual.",
    duration_minutes: 30,
    buffer_minutes: 10,
    price_amount: 6500,
    currency_code: "usd",
    location_type: "video",
    modality: "Coaching",
    is_active: true,
    is_embeddable: false,
    bookings_this_month: 5,
  },
  {
    id: "st_discovery",
    name: "Free Discovery Call",
    description: "15-min intro to see if we're a fit.",
    duration_minutes: 15,
    buffer_minutes: 5,
    price_amount: 0,
    currency_code: "usd",
    location_type: "video",
    modality: "Other",
    is_active: true,
    is_embeddable: true,
    bookings_this_month: 11,
  },
]

export const MOCK_BOOKINGS_TODAY: Booking[] = [
  {
    id: "bk_1",
    client_name: "Aria Monroe",
    client_email: "aria@example.com",
    session_type_name: "60-Minute Reiki Session",
    starts_at: "2026-06-27T14:00:00Z",
    ends_at: "2026-06-27T15:00:00Z",
    duration_minutes: 60,
    status: "confirmed",
    delivery: "virtual",
    intake_received: true,
    intake_required: true,
  },
  {
    id: "bk_2",
    client_name: "Devon Clarke",
    client_email: "devon@example.com",
    session_type_name: "Sound Healing Journey",
    starts_at: "2026-06-27T17:30:00Z",
    ends_at: "2026-06-27T18:15:00Z",
    duration_minutes: 45,
    status: "pending",
    delivery: "in_person",
    intake_received: false,
    intake_required: true,
  },
  {
    id: "bk_3",
    client_name: "Group Class",
    client_email: "",
    session_type_name: "New Moon Sound Bath",
    starts_at: "2026-06-27T23:00:00Z",
    ends_at: "2026-06-28T00:00:00Z",
    duration_minutes: 60,
    status: "confirmed",
    delivery: "in_person",
  },
]

export const MOCK_CLASSES: ClassEvent[] = [
  {
    id: "cl_newmoon",
    title: "New Moon Sound Bath",
    description: "A communal sound journey under the new moon.",
    starts_at: "2026-07-04T23:00:00Z",
    ends_at: "2026-07-05T00:30:00Z",
    capacity: 20,
    seats_taken: 17,
    waitlist_count: 2,
    price_amount: 3500,
    location_type: "in_person",
    status: "open",
  },
  {
    id: "cl_breath",
    title: "Breathwork Circle",
    description: "Guided breathwork for release.",
    starts_at: "2026-07-11T16:00:00Z",
    ends_at: "2026-07-11T17:30:00Z",
    capacity: 15,
    seats_taken: 6,
    price_amount: 2500,
    location_type: "video",
    status: "scheduled",
  },
  {
    id: "cl_past",
    title: "Full Moon Release Ritual",
    starts_at: "2026-06-20T23:00:00Z",
    ends_at: "2026-06-21T00:30:00Z",
    capacity: 20,
    seats_taken: 20,
    price_amount: 3500,
    location_type: "in_person",
    status: "completed",
    recording_url: "https://example.com/recording",
  },
]

export const MOCK_ATTENDEES: ClassAttendee[] = [
  { id: "at_1", customer_name: "Aria Monroe", customer_email: "aria@example.com", status: "registered", intake_received: true, purchased_at: "2026-06-18T12:00:00Z" },
  { id: "at_2", customer_name: "Devon Clarke", customer_email: "devon@example.com", status: "registered", intake_received: false, purchased_at: "2026-06-19T09:00:00Z" },
  { id: "at_3", customer_name: "Sam Rivera", customer_email: "sam@example.com", status: "waitlisted", purchased_at: "2026-06-22T15:00:00Z" },
]

export const MOCK_DIGITAL: DigitalProduct[] = [
  { id: "dg_med", name: "Guided Meditation Bundle", type: "bundle", price_amount: 2200, total_sales: 142, download_count: 138, status: "public" },
  { id: "dg_work", name: "Ritual Workbook (PDF)", type: "single", price_amount: 1500, total_sales: 64, download_count: 64, status: "public" },
  { id: "dg_course", name: "21-Day Energy Course", type: "course", price_amount: 8800, total_sales: 23, download_count: 19, status: "draft" },
]

export const MOCK_PHYSICAL: PhysicalProduct[] = [
  { id: "ph_tinc", name: "Calm Tincture (2oz)", category: "Tincture", sku: "TINC-CALM-2", stock: 4, price_amount: 2800, sales_per_month: 22, status: "active", bmc_sourced: true },
  { id: "ph_oil", name: "Anointing Ritual Oil", category: "Ritual Oil", sku: "OIL-RIT-1", stock: 31, price_amount: 1800, sales_per_month: 14, status: "active" },
  { id: "ph_candle", name: "Cedar + Amber Candle", category: "Candle", sku: "CAND-CA-1", stock: 12, price_amount: 2400, sales_per_month: 9, status: "active" },
]

export const MOCK_MEMBERSHIP_TIERS: MembershipTier[] = [
  { id: "mt_seed", name: "Seed", price_amount: 1500, interval: "monthly", credits_per_period: 0, discount_pct: 0, perks: ["Community room", "Monthly meditation audio"], active_members: 24 },
  { id: "mt_root", name: "Root", price_amount: 3500, interval: "monthly", credits_per_period: 0, discount_pct: 10, perks: ["Seed perks", "1 group class/mo", "10% off sessions"], active_members: 11 },
  { id: "mt_bloom", name: "Bloom", price_amount: 7500, interval: "monthly", credits_per_period: 1, discount_pct: 10, perks: ["Root perks", "1× 30-min session/mo", "Exclusive content"], active_members: 6 },
  { id: "mt_sov", name: "Sovereign", price_amount: 15000, interval: "monthly", credits_per_period: 1, discount_pct: 15, perks: ["Bloom perks", "1× 60-min session/mo", "Priority booking"], active_members: 3 },
]

export const MOCK_MEMBERS: Member[] = [
  { id: "m_1", name: "Aria Monroe", email: "aria@example.com", tier_name: "Bloom", status: "active", started_at: "2026-01-12T00:00:00Z", next_renewal_at: "2026-07-12T00:00:00Z", credits_balance: 1, ltv_amount: 54000 },
  { id: "m_2", name: "Devon Clarke", email: "devon@example.com", tier_name: "Root", status: "active", started_at: "2026-03-02T00:00:00Z", next_renewal_at: "2026-07-02T00:00:00Z", credits_balance: 0, ltv_amount: 14000 },
  { id: "m_3", name: "Jo Park", email: "jo@example.com", tier_name: "Sovereign", status: "past_due", started_at: "2025-11-20T00:00:00Z", next_renewal_at: "2026-06-29T00:00:00Z", credits_balance: 1, ltv_amount: 105000 },
]

export const MOCK_CLIENTS: ClientProfile[] = [
  { id: "cp_1", name: "Aria Monroe", email: "aria@example.com", phone: "555-0101", tier_name: "Bloom", tags: ["Reiki regular"], total_bookings: 18, lifetime_value_amount: 216000, last_seen_at: "2026-06-25T00:00:00Z", no_show_count: 0 },
  { id: "cp_2", name: "Devon Clarke", email: "devon@example.com", tier_name: "Root", tags: ["sound bath fan"], total_bookings: 6, lifetime_value_amount: 54000, last_seen_at: "2026-06-12T00:00:00Z", no_show_count: 1 },
  { id: "cp_3", name: "Sam Rivera", email: "sam@example.com", tags: ["energy sensitive"], total_bookings: 2, lifetime_value_amount: 18000, last_seen_at: "2026-03-01T00:00:00Z", no_show_count: 0 },
]

export const MOCK_DASHBOARD: DashboardSummary = {
  todays_agenda: MOCK_BOOKINGS_TODAY,
  urgent_actions: [
    { type: "booking", message: "1 booking request awaiting confirmation", count: 1, link: "/calendar" },
    { type: "intake", message: "2 upcoming clients haven't filled intake forms", count: 2, link: "/clients" },
    { type: "membership", message: "1 membership renews in <7 days", count: 1, link: "/memberships" },
    { type: "message", message: "3 Blackout messages unread >24hrs", count: 3, link: "/blackout" },
  ],
  week: [
    { date: "2026-06-27", session_count: 2, class_count: 1, revenue_cents: 21000 },
    { date: "2026-06-28", session_count: 1, class_count: 0, revenue_cents: 12000 },
    { date: "2026-06-29", session_count: 3, class_count: 0, revenue_cents: 27500 },
    { date: "2026-06-30", session_count: 2, class_count: 1, revenue_cents: 18500 },
    { date: "2026-07-01", session_count: 0, class_count: 0, revenue_cents: 0 },
  ],
  revenue: {
    sessions_cents: 184000,
    classes_cents: 52000,
    digital_cents: 31000,
    physical_cents: 22000,
    memberships_cents: 96500,
    total_cents: 385500,
    last_month_total_cents: 341000,
  },
  recent_clients: MOCK_CLIENTS,
  next_class: MOCK_CLASSES[0],
  quest_highlights: [
    { quest_title: "Reach 10 active members", current: 9, required: 10, karma_reward: 50 },
    { quest_title: "Zero no-shows this month", current: 1, required: 1, karma_reward: 20 },
  ],
}

export const MOCK_PAYOUTS: PayoutsData = {
  current_period: {
    by_type: [
      { type: "Sessions", gross_cents: 184000, net_cents: 174800 },
      { type: "Classes", gross_cents: 52000, net_cents: 49400 },
      { type: "Digital", gross_cents: 31000, net_cents: 29450 },
      { type: "Physical", gross_cents: 22000, net_cents: 20900 },
      { type: "Memberships", gross_cents: 96500, net_cents: 91675 },
    ],
    net_total_cents: 366225,
    next_payment_date: "2026-07-01T00:00:00Z",
  },
  tier: "root",
  karma_total: 312,
  history: [
    { id: "po_5", month: "2026-05", gross_cents: 341000, fee_cents: 17050, net_cents: 323950, paid_at: "2026-06-01T00:00:00Z", transfer_ref: "ach_55821" },
    { id: "po_4", month: "2026-04", gross_cents: 298000, fee_cents: 14900, net_cents: 283100, paid_at: "2026-05-01T00:00:00Z", transfer_ref: "ach_55102" },
    { id: "po_3", month: "2026-03", gross_cents: 312500, fee_cents: 15625, net_cents: 296875, paid_at: "2026-04-01T00:00:00Z", transfer_ref: "ach_54420" },
  ],
  earnings_ytd_cents: 1685000,
  w9_required: true,
}

export const MOCK_CLIENT_THREADS: ClientThread[] = [
  { room_id: "rm_1", client_name: "Aria Monroe", last_message: "Thank you, that was exactly what I needed 🙏", timestamp: "2026-06-26T18:00:00Z", unread: 2, upcoming_session_at: "2026-06-27T14:00:00Z" },
  { room_id: "rm_2", client_name: "Devon Clarke", last_message: "Can we reschedule to next week?", timestamp: "2026-06-25T10:30:00Z", unread: 1 },
  { room_id: "rm_3", client_name: "Sam Rivera", last_message: "Loved the meditation bundle!", timestamp: "2026-06-20T08:00:00Z", unread: 0 },
]

export const MOCK_BLACKOUT_DM: BlackoutMessage[] = [
  { id: "msg_1", type: "text", sender: "Aria", text: "Hi! Looking forward to today's session.", timestamp: "2026-06-27T09:00:00Z" },
  { id: "msg_2", type: "booking", text: "Booking confirmed: 60-Minute Reiki at 10am", timestamp: "2026-06-27T09:01:00Z", link: "/calendar" },
  { id: "msg_3", type: "text", sender: "Aria", text: "Perfect, intake form submitted.", timestamp: "2026-06-27T09:05:00Z" },
]

export const MOCK_COMMUNITY: BlackoutMessage[] = [
  { id: "cm_1", type: "system", text: "Welcome to the Shakti Innergy community room 🌸", timestamp: "2026-06-01T00:00:00Z" },
  { id: "cm_2", type: "text", sender: "Shakti Innergy", text: "New moon sound bath this Saturday — a few spots left!", timestamp: "2026-06-25T12:00:00Z" },
]

export const MOCK_AUTOMATIONS: AutomationTemplate[] = [
  { id: "au_1", trigger: "booking_confirmed", name: "Booking confirmed", body: "Hi [name]! Your [session_type] is confirmed for [date] at [time]. 🌿", enabled: true },
  { id: "au_2", trigger: "booking_reminder_24h", name: "24-hour reminder", body: "Reminder: your [session_type] is tomorrow at [time].", enabled: true },
  { id: "au_3", trigger: "booking_completed", name: "Post-session follow-up", body: "Thank you for our session. Rest and hydrate 💧 Review: [link]", enabled: true },
  { id: "au_4", trigger: "membership_welcome", name: "Membership welcome", body: "Welcome to [tier]! 🌸 You have [credits] credit(s). Book: [link]", enabled: false },
  { id: "au_5", trigger: "credits_low", name: "Unused credit reminder", body: "Your credit expires soon. Openings: [available_slots]", enabled: false },
]

export const MOCK_ANALYTICS: AnalyticsData = {
  revenue_by_type: [
    { month: "Mar", Sessions: 1620, Classes: 380, Digital: 240, Physical: 190, Memberships: 690 },
    { month: "Apr", Sessions: 1710, Classes: 420, Digital: 260, Physical: 210, Memberships: 780 },
    { month: "May", Sessions: 1840, Classes: 520, Digital: 310, Physical: 220, Memberships: 905 },
    { month: "Jun", Sessions: 1840, Classes: 520, Digital: 310, Physical: 220, Memberships: 965 },
  ],
  booking_rate: [
    { week: "W22", available_hours: 30, booked_hours: 22 },
    { week: "W23", available_hours: 30, booked_hours: 26 },
    { week: "W24", available_hours: 30, booked_hours: 25 },
    { week: "W25", available_hours: 30, booked_hours: 28 },
  ],
  retention: [
    { month: "Mar", new_clients: 9, returning_clients: 22 },
    { month: "Apr", new_clients: 7, returning_clients: 26 },
    { month: "May", new_clients: 11, returning_clients: 29 },
    { month: "Jun", new_clients: 6, returning_clients: 31 },
  ],
  session_performance: [
    { name: "60-Min Reiki", sessions: 14, revenue_cents: 168000 },
    { name: "Sound Healing", sessions: 8, revenue_cents: 72000 },
    { name: "Coaching 30", sessions: 5, revenue_cents: 32500 },
  ],
  class_fill: [
    { name: "New Moon Sound Bath", capacity: 20, attendees: 17 },
    { name: "Breathwork Circle", capacity: 15, attendees: 6 },
    { name: "Full Moon Ritual", capacity: 20, attendees: 20 },
  ],
  mrr_trend: [
    { month: "Mar", mrr_cents: 69000 },
    { month: "Apr", mrr_cents: 78000 },
    { month: "May", mrr_cents: 90500 },
    { month: "Jun", mrr_cents: 96500 },
  ],
  insights: [
    "Your most booked session is 60-Min Reiki at 14 sessions this month.",
    "New Moon Sound Bath has an 85% fill rate — consider adding a second date.",
    "You have 1 lapsed client who hasn't booked in >90 days. Send a re-engagement DM.",
    "Guided Meditation Bundle is your top digital product — consider a Part 2.",
  ],
}

export const MOCK_EMBED: EmbedConfig = {
  masked_key: "pk_live_…a1b2",
  snippet:
    '<script src="https://freeblackmarket.com/connect.js"\n  data-fbm-vendor="shakti-innergy"\n  data-fbm-key="pk_live_…a1b2"\n  data-fbm-theme="warm">\n</script>\n<div data-fbm="products"></div>',
  theme: "warm",
  embeddable: {
    session_types: MOCK_SESSION_TYPES.map((s) => ({ id: s.id, name: s.name, embedded: s.is_embeddable })),
    classes: MOCK_CLASSES.map((c) => ({ id: c.id, name: c.title, embedded: true })),
  },
  analytics: { views: 1280, clicks: 214, purchases: 38, conversion_pct: 3.0 },
}
