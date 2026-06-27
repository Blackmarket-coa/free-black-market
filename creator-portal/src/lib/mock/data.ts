// Typed mock layer for the creator portal. While the FBM creator-hub read
// routes are wired, hooks resolve from here (USE_MOCK_DATA in lib/api.ts).
// Dates are anchored around late June 2026 so the dashboard looks live.
import type {
  AnalyticsData,
  BlackoutMessage,
  Boost,
  CreditBalance,
  CreditTransaction,
  DashboardSummary,
  EmbedConfig,
  GovernanceProposal,
  Member,
  MemberThread,
  MembershipTier,
  PayoutsData,
  QuestHighlight,
  SplitContract,
  XpBalance,
} from "@/types"

export const MOCK_MEMBERSHIP_TIERS: MembershipTier[] = [
  {
    id: "tier_signal",
    name: "Signal",
    price_amount: 500,
    interval: "monthly",
    blackout_tier: "signal",
    credits_per_period: 50,
    perks: ["Members-only room", "Monthly AMA", "Signal badge"],
    active_members: 184,
  },
  {
    id: "tier_signal_plus",
    name: "Signal+",
    price_amount: 1500,
    interval: "monthly",
    blackout_tier: "signal_plus",
    credits_per_period: 200,
    perks: ["Everything in Signal", "Dead-drop archive", "Priority DMs", "Stream shoutouts"],
    active_members: 76,
  },
  {
    id: "tier_community",
    name: "Community",
    price_amount: 4000,
    interval: "monthly",
    blackout_tier: "community",
    credits_per_period: 600,
    perks: ["Everything in Signal+", "Smart-split revenue share", "Co-governance vote"],
    active_members: 21,
  },
]

export const MOCK_MEMBERS: Member[] = [
  {
    id: "mem_1",
    name: "Ari Okafor",
    email: "ari@example.com",
    tier_name: "Community",
    status: "active",
    started_at: "2025-11-02T00:00:00Z",
    next_renewal_at: "2026-07-02T00:00:00Z",
    ltv_amount: 32000,
    matrix_id: "@ari:theblackout.app",
    sync_status: "in_sync",
  },
  {
    id: "mem_2",
    name: "Devon Reyes",
    email: "devon@example.com",
    tier_name: "Signal+",
    status: "active",
    started_at: "2026-01-14T00:00:00Z",
    next_renewal_at: "2026-07-14T00:00:00Z",
    ltv_amount: 9000,
    matrix_id: "@devon:theblackout.app",
    sync_status: "drift",
  },
  {
    id: "mem_3",
    name: "Priya Nair",
    email: "priya@example.com",
    tier_name: "Signal",
    status: "active",
    started_at: "2026-03-21T00:00:00Z",
    next_renewal_at: "2026-07-21T00:00:00Z",
    ltv_amount: 2000,
    matrix_id: null,
    sync_status: "no_mxid",
  },
  {
    id: "mem_4",
    name: "Sam Whitfield",
    email: "sam@example.com",
    tier_name: "Signal",
    status: "past_due",
    started_at: "2025-09-09T00:00:00Z",
    next_renewal_at: "2026-06-25T00:00:00Z",
    ltv_amount: 4500,
    matrix_id: "@sam:theblackout.app",
    sync_status: "in_sync",
  },
  {
    id: "mem_5",
    name: "Lena Cho",
    email: "lena@example.com",
    tier_name: "Signal+",
    status: "active",
    started_at: "2026-02-02T00:00:00Z",
    next_renewal_at: "2026-07-02T00:00:00Z",
    ltv_amount: 7500,
    matrix_id: "@lena:theblackout.app",
    sync_status: "in_sync",
  },
]

export const MOCK_CREDIT_BALANCE: CreditBalance = {
  available_credits: 18420,
  pending_credits: 3200,
  lifetime_earned: 96250,
}

export const MOCK_CREDIT_TXNS: CreditTransaction[] = [
  { id: "ctx_1", type: "tip", amount_credits: 485, counterparty: "@ari:theblackout.app", room: "#main", created_at: "2026-06-27T13:02:00Z", blackout_event_id: "$tip1:theblackout.app" },
  { id: "ctx_2", type: "membership", amount_credits: 1425, counterparty: "Signal+ renewal", created_at: "2026-06-27T09:14:00Z" },
  { id: "ctx_3", type: "boost", amount_credits: 200, counterparty: "@lena:theblackout.app", room: "#hype", created_at: "2026-06-26T20:41:00Z", blackout_event_id: "$boost9:theblackout.app" },
  { id: "ctx_4", type: "platform_fee", amount_credits: -52, counterparty: "BMC platform (3%)", created_at: "2026-06-26T20:41:00Z" },
  { id: "ctx_5", type: "dead_drop", amount_credits: 900, counterparty: "Vault: stem-pack vol.3", created_at: "2026-06-25T11:09:00Z" },
  { id: "ctx_6", type: "xp_conversion", amount_credits: 50, counterparty: "1,000 XP → ₡50", created_at: "2026-06-24T16:22:00Z" },
  { id: "ctx_7", type: "withdrawal", amount_credits: -10000, counterparty: "ACH → ****4821", created_at: "2026-06-20T08:00:00Z" },
]

export const MOCK_XP_BALANCES: XpBalance[] = [
  { space_id: "!coalition:theblackout.app", space_name: "Strand Coalition", xp: 7400 },
  { space_id: "!makers:theblackout.app", space_name: "Makers Mutual", xp: 2150 },
]

export const MOCK_BOOSTS: Boost[] = [
  {
    id: "boost_hype1",
    type: "hype_train",
    title: "Season 3 Hype Train",
    status: "active",
    goal_credits: 5000,
    current_credits: 3260,
    contributor_count: 48,
    milestones: [
      { credits: 1000, reward: "Emoji drop unlocked", unlocked: true },
      { credits: 2500, reward: "Bonus stream this Friday", unlocked: true },
      { credits: 5000, reward: "Free dead-drop for all members", unlocked: false },
    ],
    ends_at: "2026-06-29T00:00:00Z",
    matrix_state_event_id: "$boostevt1:theblackout.app",
  },
  {
    id: "boost_rally1",
    type: "fundraiser_rally",
    title: "New ribbon mic fund",
    status: "active",
    goal_credits: 12000,
    current_credits: 8800,
    contributor_count: 63,
    milestones: [
      { credits: 6000, reward: "Behind-the-scenes vlog", unlocked: true },
      { credits: 12000, reward: "Mic purchased + unboxing stream", unlocked: false },
    ],
    ends_at: "2026-07-10T00:00:00Z",
    linked_product_name: "AEA R44 Ribbon Microphone",
    matrix_state_event_id: "$boostevt2:theblackout.app",
  },
  {
    id: "boost_done1",
    type: "hype_train",
    title: "Launch week train",
    status: "succeeded",
    goal_credits: 3000,
    current_credits: 3420,
    contributor_count: 71,
    milestones: [{ credits: 3000, reward: "Launch party stream", unlocked: true }],
    ends_at: "2026-05-30T00:00:00Z",
    matrix_state_event_id: "$boostevt0:theblackout.app",
  },
]

export const MOCK_SPLITS: SplitContract[] = [
  {
    id: "split_1",
    name: "Title track feat. Mara",
    status: "active",
    parties: [
      { name: "Nova Strand", matrix_id: "@nova:theblackout.app", pct: 65, is_creator: true },
      { name: "Mara Lindqvist", matrix_id: "@mara:theblackout.app", pct: 35 },
    ],
    created_at: "2026-06-10T00:00:00Z",
    activated_at: "2026-06-11T00:00:00Z",
    matrix_event_id: "$splitabc123:theblackout.app",
    space_id: "!coalition:theblackout.app",
  },
  {
    id: "split_2",
    name: "Members zine vol.2 (3-way)",
    status: "draft",
    parties: [
      { name: "Nova Strand", matrix_id: "@nova:theblackout.app", pct: 50, is_creator: true },
      { name: "Kofi A.", matrix_id: "@kofi:theblackout.app", pct: 30 },
      { name: "Illustrator pool", pct: 20 },
    ],
    created_at: "2026-06-24T00:00:00Z",
    matrix_event_id: null,
    space_id: "!coalition:theblackout.app",
  },
]

export const MOCK_PAYOUTS: PayoutsData = {
  current_period: {
    by_type: [
      { type: "Memberships", gross_cents: 412000, net_cents: 391400 },
      { type: "Tips", gross_cents: 86000, net_cents: 83420 },
      { type: "Boosts", gross_cents: 54000, net_cents: 52380 },
      { type: "Dead-drops", gross_cents: 28000, net_cents: 27160 },
    ],
    net_total_cents: 554360,
    next_payment_date: "2026-07-01T00:00:00Z",
  },
  tier: "canopy",
  karma_total: 612,
  earnings_ytd_cents: 2840000,
  w9_required: true,
  history: [
    { id: "po_1", month: "2026-05", gross_cents: 598000, fee_cents: 29900, net_cents: 568100, paid_at: "2026-06-01T00:00:00Z", transfer_ref: "ach_5f21" },
    { id: "po_2", month: "2026-04", gross_cents: 521000, fee_cents: 26050, net_cents: 494950, paid_at: "2026-05-01T00:00:00Z", transfer_ref: "ach_4d90" },
    { id: "po_3", month: "2026-03", gross_cents: 470000, fee_cents: 23500, net_cents: 446500, paid_at: "2026-04-01T00:00:00Z", transfer_ref: "ach_3c12" },
  ],
}

export const MOCK_MEMBER_THREADS: MemberThread[] = [
  { room_id: "!dm-ari:theblackout.app", member_name: "Ari Okafor", last_message: "thank you for the split contract!", timestamp: "2026-06-27T12:40:00Z", unread: 2, tier_name: "Community" },
  { room_id: "!dm-lena:theblackout.app", member_name: "Lena Cho", last_message: "is the dead-drop still up?", timestamp: "2026-06-27T10:05:00Z", unread: 1, tier_name: "Signal+" },
  { room_id: "!dm-sam:theblackout.app", member_name: "Sam Whitfield", last_message: "renewing this week, card issue", timestamp: "2026-06-26T18:22:00Z", unread: 0, tier_name: "Signal" },
]

export const MOCK_DM: BlackoutMessage[] = [
  { id: "dm1", type: "text", sender: "Ari Okafor", text: "loved the last stream", timestamp: "2026-06-27T12:30:00Z" },
  { id: "dm2", type: "tip", text: "Ari tipped ₡485", timestamp: "2026-06-27T12:35:00Z" },
  { id: "dm3", type: "text", sender: "Ari Okafor", text: "thank you for the split contract!", timestamp: "2026-06-27T12:40:00Z" },
]

export const MOCK_COMMUNITY: BlackoutMessage[] = [
  { id: "c1", type: "boost", text: "🚀 Season 3 Hype Train hit 2,500₡ — bonus stream Friday!", timestamp: "2026-06-27T11:00:00Z", link: "/boosts" },
  { id: "c2", type: "membership", text: "Lena upgraded to Signal+", timestamp: "2026-06-27T09:20:00Z" },
  { id: "c3", type: "tip", text: "@ari tipped ₡485 in #main", timestamp: "2026-06-27T13:02:00Z" },
  { id: "c4", type: "system", text: "Smart-split 'Title track feat. Mara' recorded on Blackout", timestamp: "2026-06-11T00:01:00Z" },
  { id: "c5", type: "text", sender: "Devon", text: "the new vault pack is incredible", timestamp: "2026-06-26T21:10:00Z" },
]

export const MOCK_PROPOSALS: GovernanceProposal[] = [
  {
    id: "prop_1",
    title: "Next dead-drop theme",
    description: "Members vote on what the July vault pack should focus on.",
    options: ["Ambient stems", "Drum one-shots", "Vocal chops"],
    deadline: "2026-07-01T00:00:00Z",
    tally: { "Ambient stems": 34, "Drum one-shots": 51, "Vocal chops": 22 },
    status: "open",
  },
  {
    id: "prop_2",
    title: "Allocate boost surplus",
    description: "The launch train overfunded by 420₡ — where should it go?",
    options: ["Member raffle", "Roll into next boost", "Donate to coalition fund"],
    deadline: "2026-06-20T00:00:00Z",
    tally: { "Member raffle": 12, "Roll into next boost": 40, "Donate to coalition fund": 18 },
    status: "closed",
    outcome: "Roll into next boost",
  },
]

export const MOCK_QUESTS: QuestHighlight[] = [
  { quest_title: "Run 3 Governance Boosts", current: 2, required: 3, karma_reward: 50 },
  { quest_title: "Onboard 10 Community members", current: 21, required: 10, karma_reward: 80 },
  { quest_title: "Activate a Smart Split", current: 1, required: 1, karma_reward: 30 },
]

export const MOCK_ANALYTICS: AnalyticsData = {
  revenue_by_type: [
    { month: "Mar", memberships: 4100, tips: 620, boosts: 300 },
    { month: "Apr", memberships: 4600, tips: 740, boosts: 380 },
    { month: "May", memberships: 5200, tips: 810, boosts: 540 },
    { month: "Jun", memberships: 5540, tips: 860, boosts: 620 },
  ],
  mrr_trend: [
    { month: "Mar", mrr_cents: 410000 },
    { month: "Apr", mrr_cents: 460000 },
    { month: "May", mrr_cents: 520000 },
    { month: "Jun", mrr_cents: 554000 },
  ],
  members_growth: [
    { month: "Mar", new_members: 38, churned_members: 9 },
    { month: "Apr", new_members: 44, churned_members: 11 },
    { month: "May", new_members: 51, churned_members: 8 },
    { month: "Jun", new_members: 33, churned_members: 12 },
  ],
  credits_flow: [
    { week: "W1", tips_credits: 820, boosts_credits: 1200 },
    { week: "W2", tips_credits: 940, boosts_credits: 900 },
    { week: "W3", tips_credits: 1100, boosts_credits: 1600 },
    { week: "W4", tips_credits: 1320, boosts_credits: 2100 },
  ],
  top_supporters: [
    { name: "Ari Okafor", credits: 4820 },
    { name: "Lena Cho", credits: 3110 },
    { name: "Devon Reyes", credits: 2040 },
  ],
  insights: [
    "Signal+ is your fastest-growing tier — up 18% this month.",
    "Boost contributions spike on stream days; schedule the next Hype Train around a stream.",
    "3 members are in drift — run a force-sync to restore their Space rooms.",
  ],
}

export const MOCK_EMBED: EmbedConfig = {
  masked_key: "pk_live_••••8f2a",
  theme: "warm",
  snippet: `<script src="https://connect.freeblackmarket.com/v1/connect.js"
  data-fbm-key="pk_live_xxxx"
  data-fbm-theme="warm"
  data-fbm-creator="nova-strand"></script>
<div data-fbm-embed="memberships"></div>`,
  embeddable: {
    memberships: [
      { id: "tier_signal", name: "Signal membership", embedded: true },
      { id: "tier_signal_plus", name: "Signal+ membership", embedded: true },
      { id: "tier_community", name: "Community membership", embedded: false },
    ],
    products: [
      { id: "dd_1", name: "Stem pack vol.3", embedded: true },
      { id: "dd_2", name: "Preset bundle", embedded: false },
    ],
  },
  analytics: { views: 5400, clicks: 612, purchases: 88, conversion_pct: 14.4 },
}

export const MOCK_DASHBOARD: DashboardSummary = {
  credits_earned_today: 2110,
  new_members_today: 4,
  unread_dms: 3,
  mrr_change_this_week_cents: 18400,
  active_boost: MOCK_BOOSTS[0],
  refrain_queue: { pending_review: 2, awaiting_delivery: 1, in_revision: 1 },
  space_health: {
    weekly_active_members_pct: 62,
    governance_participation_pct: 41,
    messages_per_room_avg: 23,
    retention_30d_pct: 88,
  },
  urgent_actions: [
    { type: "membership", message: "3 members are out of sync with their Blackout rooms", count: 3, link: "/memberships" },
    { type: "refrain", message: "2 Refrain bounties awaiting your review", count: 2, link: "/dashboard" },
    { type: "split", message: "'Members zine vol.2' split is still a draft — activate to record it", link: "/splits" },
  ],
  recent_activity: MOCK_COMMUNITY.slice(0, 4),
  quest_highlights: MOCK_QUESTS,
}
