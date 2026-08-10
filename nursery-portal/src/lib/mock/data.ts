// Typed mock fixtures backing the portal while the nursery backend routes are
// built. Anchored around June 2026 (summer — softwood-cutting season). Swapping
// to live data is a per-hook change in src/hooks; these shapes match src/types.

import type {
  DashboardSummary,
  InventoryItem,
  PropagationBatch,
  StratificationRecord,
  MotherPlant,
  NurseryOrder,
  DoaClaim,
  PayoutsData,
  BlackoutMessage,
  GovernanceProposal,
  NodeHealth,
  ListingsData,
  AnalyticsSummary,
  WholesaleData,
  NetworkData,
  QuestCatalogEntry,
  QuestEnrollmentItem,
} from "@/types"

export const MOCK_BATCHES: PropagationBatch[] = [
  {
    id: "batch_01",
    species_name: "Beautyberry",
    method: "cutting",
    status: "rooting",
    qty_started: 60,
    qty_successful: 48,
    started_at: "2026-06-10T00:00:00Z",
    expected_ready_at: "2026-09-30T00:00:00Z",
    pot_size: "4in",
    hub_requested: true,
    notes: "Softwood, under mist bench.",
  },
  {
    id: "batch_02",
    species_name: "Fig — Chicago Hardy",
    method: "cutting",
    status: "growing_out",
    qty_started: 40,
    qty_successful: 34,
    started_at: "2026-02-01T00:00:00Z",
    expected_ready_at: "2026-07-15T00:00:00Z",
    pot_size: "1gal",
    notes: "Hardwood from Jan window, potted up.",
  },
  {
    id: "batch_03",
    species_name: "Banana — Dwarf Cavendish",
    method: "division",
    status: "ready",
    qty_started: 12,
    qty_successful: 12,
    started_at: "2026-04-05T00:00:00Z",
    expected_ready_at: "2026-06-20T00:00:00Z",
    pot_size: "2gal",
  },
  {
    id: "batch_04",
    species_name: "Elderberry",
    method: "cutting",
    status: "germinating",
    qty_started: 80,
    qty_successful: 0,
    started_at: "2026-06-22T00:00:00Z",
    expected_ready_at: "2026-11-01T00:00:00Z",
    pot_size: "tray",
    hub_requested: true,
    notes: "Hub-requested 80 ct.",
  },
  {
    id: "batch_05",
    species_name: "Lychee",
    method: "airlayer",
    status: "growing_out",
    qty_started: 6,
    qty_successful: 5,
    started_at: "2026-04-20T00:00:00Z",
    expected_ready_at: "2026-08-30T00:00:00Z",
    pot_size: "3gal",
    is_rare_species: true,
  },
]

export const MOCK_INVENTORY_READY: InventoryItem[] = [
  { id: "inv_01", species_name: "Banana — Dwarf Cavendish", method: "division", quantity: 12, pot_size: "2gal", age_label: "10 wk", days_in_stock: 7 },
  { id: "inv_02", species_name: "Pineapple guava", method: "cutting", quantity: 22, pot_size: "1gal", age_label: "6 mo", days_in_stock: 41 },
  { id: "inv_03", species_name: "Rosemary", method: "cutting", quantity: 64, pot_size: "4in", age_label: "3 mo", days_in_stock: 12 },
  { id: "inv_04", species_name: "Mulberry — Dwarf Everbearing", method: "cutting", quantity: 18, pot_size: "1gal", age_label: "5 mo", days_in_stock: 25 },
]

export const MOCK_MOTHER_PLANTS: MotherPlant[] = [
  { id: "mom_01", species_name: "Fig — Chicago Hardy", location: "Hoop A, row 2", last_harvest_at: "2026-01-20T00:00:00Z", next_harvest_window: "Jan 2027", estimated_yield: 120 },
  { id: "mom_02", species_name: "Elderberry", location: "Field edge", last_harvest_at: "2026-01-15T00:00:00Z", next_harvest_window: "Jan 2027", estimated_yield: 200 },
  { id: "mom_03", species_name: "Beautyberry", location: "Hoop B, row 1", last_harvest_at: "2026-06-10T00:00:00Z", next_harvest_window: "Jul 2026", estimated_yield: 80 },
]

export const MOCK_STRATIFICATION: StratificationRecord[] = [
  { id: "strat_01", species_name: "Persimmon", type: "cold moist", start_at: "2026-12-15T00:00:00Z", duration_days: 90, end_at: "2027-03-15T00:00:00Z", location: "Fridge 1, bin C" },
  { id: "strat_02", species_name: "Pawpaw", type: "cold moist", start_at: "2025-12-01T00:00:00Z", duration_days: 100, end_at: "2026-03-11T00:00:00Z", location: "Fridge 1, bin A" },
]

export const MOCK_ORDERS: NurseryOrder[] = [
  {
    id: "ord_1042",
    buyer_name: "M. Alvarez",
    lines: [{ species_name: "Banana — Dwarf Cavendish", qty: 2 }],
    destination_state: "TX",
    ship_by: "2026-06-29T00:00:00Z",
    status: "unfulfilled",
    total_cents: 5800,
    created_at: "2026-06-26T14:20:00Z",
  },
  {
    id: "ord_1041",
    buyer_name: "J. Okafor",
    lines: [{ species_name: "Rosemary", qty: 4 }, { species_name: "Pineapple guava", qty: 1 }],
    destination_state: "CA",
    ship_by: "2026-06-30T00:00:00Z",
    status: "unfulfilled",
    total_cents: 9200,
    created_at: "2026-06-26T09:05:00Z",
  },
  {
    id: "ord_1039",
    buyer_name: "S. Whitfield",
    lines: [{ species_name: "Mulberry — Dwarf Everbearing", qty: 1 }],
    destination_state: "GA",
    ship_by: "2026-06-28T00:00:00Z",
    status: "label_ready",
    total_cents: 4200,
    created_at: "2026-06-25T18:40:00Z",
  },
  {
    id: "ord_1035",
    buyer_name: "R. Nakamura",
    lines: [{ species_name: "Pineapple guava", qty: 3 }],
    destination_state: "FL",
    ship_by: "2026-06-24T00:00:00Z",
    status: "shipped",
    total_cents: 11400,
    tracking_number: "9400 1112 3456 7890",
    created_at: "2026-06-20T11:00:00Z",
  },
]

export const MOCK_DOA_CLAIMS: DoaClaim[] = [
  {
    id: "doa_01",
    order_id: "ord_1018",
    species_name: "Lychee",
    buyer_reason: "Arrived with crushed top growth, leaves blackened.",
    opened_at: "2026-06-23T00:00:00Z",
    status: "open",
  },
]

export const MOCK_PAYOUTS: PayoutsData = {
  current_period: {
    units_sold: 86,
    gross_cents: 412000,
    split_pct: 62,
    net_cents: 255440,
    next_payment_date: "2026-07-05",
  },
  tier: "sprout",
  karma_total: 142,
  karma_events: [
    { id: "ke_1", type: "rare_species_sale", karma: 10, at: "2026-06-18T00:00:00Z", description: "Sold a Lychee (rare species)." },
    { id: "ke_2", type: "photo_verified", karma: 5, at: "2026-06-15T00:00:00Z", description: "Batch photo verified by Hub." },
    { id: "ke_3", type: "on_time_fulfillment", karma: 3, at: "2026-06-12T00:00:00Z", description: "Order shipped before ship-by date." },
    { id: "ke_4", type: "hub_request_filled", karma: 8, at: "2026-06-08T00:00:00Z", description: "Filled Hub elderberry cutting request." },
  ],
  history: [
    { id: "p_05", month: "2026-05", units_sold: 78, gross_cents: 366000, split_pct: 62, net_cents: 226920, paid_at: "2026-06-05", transfer_ref: "ach_5f2a" },
    { id: "p_04", month: "2026-04", units_sold: 64, gross_cents: 298000, split_pct: 60, net_cents: 178800, paid_at: "2026-05-05", transfer_ref: "ach_4b18" },
    { id: "p_03", month: "2026-03", units_sold: 51, gross_cents: 233000, split_pct: 60, net_cents: 139800, paid_at: "2026-04-05", transfer_ref: "ach_3c77" },
  ],
  split_breakdown: [
    { product_name: "Pineapple guava 1gal", units: 28, gross_cents: 154000, your_cut_cents: 95480 },
    { product_name: "Rosemary 4in", units: 40, gross_cents: 96000, your_cut_cents: 59520 },
    { product_name: "Banana 2gal", units: 12, gross_cents: 88000, your_cut_cents: 54560 },
    { product_name: "Mulberry 1gal", units: 6, gross_cents: 74000, your_cut_cents: 45880 },
  ],
  earnings_ytd_cents: 800960,
  w9_required: true,
}

export const MOCK_BLACKOUT_NODE: BlackoutMessage[] = [
  { id: "m1", type: "order", text: "New order #1042 — 2× Banana to TX", timestamp: "2026-06-26T14:20:00Z", order_id: "ord_1042" },
  { id: "m2", type: "label", text: "Label ready for #1039", timestamp: "2026-06-26T08:12:00Z", download_url: "/api/vendor/plant-nursery/orders/ord_1039/label" },
  { id: "m3", type: "low_stock", text: "Rosemary 4in running low — 64 left", timestamp: "2026-06-25T20:00:00Z", link: "/inventory" },
  { id: "m4", type: "photo", text: "Hub requests a photo of the elderberry batch", timestamp: "2026-06-25T16:30:00Z" },
  { id: "m5", type: "text", sender: "Hub", text: "Great work hitting the June fig numbers, GA node 🙌", timestamp: "2026-06-24T12:00:00Z" },
]

export const MOCK_BLACKOUT_NETWORK: BlackoutMessage[] = [
  { id: "n1", type: "text", sender: "Hub", text: "Summer softwood window is open network-wide — beautyberry, guava, rosemary.", timestamp: "2026-06-20T09:00:00Z" },
  { id: "n2", type: "text", sender: "Hub", text: "Wholesale plug demand spiking for elderberry in VA/NC/MD.", timestamp: "2026-06-18T15:00:00Z" },
  { id: "n3", type: "text", sender: "Hub", text: "Next coordinated Blackout fulfillment day: July 8.", timestamp: "2026-06-15T10:00:00Z" },
]

export const MOCK_PROPOSALS: GovernanceProposal[] = [
  {
    id: "prop_07",
    title: "Raise rare-species sale KARMA from 10 → 15",
    description: "Incentivize propagation of harder, higher-value species across nodes.",
    options: ["For", "Against", "Abstain"],
    deadline: "2026-07-01T00:00:00Z",
    tally: { For: 11, Against: 3, Abstain: 2 },
    status: "open",
  },
  {
    id: "prop_06",
    title: "Adopt shared heat-pack supplier for winter shipping",
    description: "Bulk-buy heat packs through the Hub to cut per-node cost.",
    options: ["For", "Against"],
    deadline: "2026-05-15T00:00:00Z",
    tally: { For: 14, Against: 1 },
    status: "closed",
    outcome: "Passed",
  },
]

export const MOCK_NETWORK_HEALTH: NodeHealth[] = [
  { node_id: "node_ga", name: "GA", state: "GA", tier: "sprout", units_this_month: 86, pending_fulfillments: 2, health: "green" },
  { node_id: "node_fl", name: "FL", state: "FL", tier: "root", units_this_month: 104, pending_fulfillments: 1, health: "green" },
  { node_id: "node_nc", name: "NC", state: "NC", tier: "seedling", units_this_month: 22, pending_fulfillments: 5, health: "yellow" },
  { node_id: "node_va", name: "VA", state: "VA", tier: "sprout", units_this_month: 0, pending_fulfillments: 4, health: "red" },
]

export const MOCK_DASHBOARD: DashboardSummary = {
  urgent_actions: [
    { type: "orders", message: "2 orders ready to fulfill", count: 2, link: "/orders" },
    { type: "seasonal", message: "Beautyberry softwood window is open now", link: "/seasonal" },
    { type: "compliance", message: "Order to CA needs a phyto cert before a label can be made", count: 1, link: "/orders" },
    { type: "quest", message: "Quest ready to claim: First Roots", link: "/quests" },
  ],
  todays_metrics: {
    orders_pending: 2,
    units_in_propagation: 192,
    active_listings: 14,
    month_earnings_cents: 300760,
  },
  propagation_batches: MOCK_BATCHES.filter((b) =>
    ["started", "germinating", "rooting", "growing_out"].includes(b.status)
  ),
  recent_orders: MOCK_ORDERS.slice(0, 5),
  seasonal_alerts: [
    { action: "Take beautyberry softwood cuttings (Jun–Aug window)", species: "Beautyberry", urgency: "high" },
    { action: "Divide banana pups while warm (Apr–Sep)", species: "Banana", urgency: "med" },
    { action: "Plan elderberry hardwood stock for Jan window", species: "Elderberry", urgency: "low" },
  ],
  blackout_preview: MOCK_BLACKOUT_NODE.slice(0, 3),
  quest_highlights: [
    { quest_title: "First Roots", current: 50, required: 50, karma_reward: 25 },
    { quest_title: "Summer Softwood Sprint", current: 48, required: 100, karma_reward: 40 },
    { quest_title: "Fill the Hub Order", current: 0, required: 80, karma_reward: 30 },
  ],
  network_health: MOCK_NETWORK_HEALTH,
}

// ── Listings & Order Cycles ─────────────────────────────────────────────────

export const MOCK_LISTINGS: ListingsData = {
  listings: [
    { id: "lst_01", species_name: "Banana — Dwarf Cavendish", category: "Fruit & nut", pot_size: "2gal", price_cents: 2900, stock: 12, status: "active", orders_30d: 9 },
    { id: "lst_02", species_name: "Pineapple guava", category: "Fruit & nut", pot_size: "1gal", price_cents: 3800, stock: 22, status: "active", orders_30d: 14 },
    { id: "lst_03", species_name: "Rosemary", category: "Herbs", pot_size: "4in", price_cents: 1200, stock: 64, status: "active", orders_30d: 31 },
    { id: "lst_04", species_name: "Mulberry — Dwarf Everbearing", category: "Fruit & nut", pot_size: "1gal", price_cents: 4200, stock: 18, status: "active", orders_30d: 6 },
    { id: "lst_05", species_name: "Fig — Chicago Hardy", category: "Fruit & nut", pot_size: "1gal", price_cents: 3400, stock: 0, status: "sold_out", orders_30d: 21 },
    { id: "lst_06", species_name: "Lychee", category: "Rare & tropical", pot_size: "3gal", price_cents: 8900, stock: 5, status: "active", orders_30d: 2 },
    { id: "lst_07", species_name: "Beautyberry", category: "Natives", pot_size: "4in", price_cents: 1400, stock: 30, status: "paused", orders_30d: 0 },
  ],
  order_cycles: [
    { id: "oc_07", name: "July Blackout drop", opens_at: "2026-07-01T00:00:00Z", closes_at: "2026-07-08T00:00:00Z", status: "open", order_count: 23, gross_cents: 96400 },
    { id: "oc_06", name: "Summer natives pre-order", opens_at: "2026-07-15T00:00:00Z", closes_at: "2026-07-29T00:00:00Z", status: "upcoming", order_count: 0, gross_cents: 0 },
    { id: "oc_05", name: "June fig & fruit cycle", opens_at: "2026-06-01T00:00:00Z", closes_at: "2026-06-14T00:00:00Z", status: "fulfilling", order_count: 41, gross_cents: 168200 },
    { id: "oc_04", name: "Spring herb flat sale", opens_at: "2026-04-06T00:00:00Z", closes_at: "2026-04-20T00:00:00Z", status: "closed", order_count: 58, gross_cents: 122600 },
  ],
  demand_pool: [
    { id: "dp_01", species_name: "Elderberry", requests: 34, top_states: ["VA", "NC", "MD"], suggested_method: "cutting", activated: true },
    { id: "dp_02", species_name: "Pawpaw", requests: 27, top_states: ["GA", "TN", "KY"], suggested_method: "seed", activated: false },
    { id: "dp_03", species_name: "Muscadine", requests: 19, top_states: ["GA", "SC", "FL"], suggested_method: "cutting", activated: false },
    { id: "dp_04", species_name: "Persimmon — American", requests: 12, top_states: ["NC", "VA"], suggested_method: "seed", activated: false },
  ],
}

// ── Analytics ───────────────────────────────────────────────────────────────

export const MOCK_ANALYTICS: AnalyticsSummary = {
  revenue_by_month: [
    { month: "2026-01", gross_cents: 118000, net_cents: 70800, fees_cents: 47200, units: 26 },
    { month: "2026-02", gross_cents: 146000, net_cents: 87600, fees_cents: 58400, units: 31 },
    { month: "2026-03", gross_cents: 233000, net_cents: 139800, fees_cents: 93200, units: 51 },
    { month: "2026-04", gross_cents: 298000, net_cents: 178800, fees_cents: 119200, units: 64 },
    { month: "2026-05", gross_cents: 366000, net_cents: 226920, fees_cents: 139080, units: 78 },
    { month: "2026-06", gross_cents: 412000, net_cents: 255440, fees_cents: 156560, units: 86 },
  ],
  method_success: [
    { method: "cutting", batches: 9, qty_started: 340, qty_successful: 261 },
    { method: "division", batches: 4, qty_started: 52, qty_successful: 49 },
    { method: "seed", batches: 3, qty_started: 120, qty_successful: 71 },
    { method: "airlayer", batches: 2, qty_started: 14, qty_successful: 11 },
  ],
  top_species: [
    { species_name: "Pineapple guava", units: 92, revenue_cents: 349600, avg_price_cents: 3800, doa_count: 1 },
    { species_name: "Rosemary", units: 176, revenue_cents: 211200, avg_price_cents: 1200, doa_count: 0 },
    { species_name: "Fig — Chicago Hardy", units: 58, revenue_cents: 197200, avg_price_cents: 3400, doa_count: 2 },
    { species_name: "Banana — Dwarf Cavendish", units: 44, revenue_cents: 127600, avg_price_cents: 2900, doa_count: 1 },
    { species_name: "Mulberry — Dwarf Everbearing", units: 29, revenue_cents: 121800, avg_price_cents: 4200, doa_count: 0 },
    { species_name: "Lychee", units: 8, revenue_cents: 71200, avg_price_cents: 8900, doa_count: 2 },
  ],
  sales_by_state: [
    { state: "GA", units: 68 },
    { state: "FL", units: 61 },
    { state: "TX", units: 47 },
    { state: "NC", units: 39 },
    { state: "CA", units: 34 },
    { state: "VA", units: 28 },
    { state: "TN", units: 19 },
    { state: "SC", units: 15 },
  ],
  doa_rate_trend: [
    { month: "2026-01", rate: 0.038 },
    { month: "2026-02", rate: 0.032 },
    { month: "2026-03", rate: 0.02 },
    { month: "2026-04", rate: 0.016 },
    { month: "2026-05", rate: 0.013 },
    { month: "2026-06", rate: 0.012 },
  ],
}

// ── Wholesale (hub only) ────────────────────────────────────────────────────

export const MOCK_WHOLESALE: WholesaleData = {
  price_sheet: [
    { id: "ws_01", species_name: "Elderberry", format: "72-cell plug tray", unit_price_cents: 16500, min_order_qty: 2, available_qty: 14, lead_time_weeks: 0 },
    { id: "ws_02", species_name: "Beautyberry", format: "72-cell plug tray", unit_price_cents: 14900, min_order_qty: 2, available_qty: 6, lead_time_weeks: 4 },
    { id: "ws_03", species_name: "Rosemary", format: "50-cell liner tray", unit_price_cents: 11000, min_order_qty: 4, available_qty: 22, lead_time_weeks: 0 },
    { id: "ws_04", species_name: "Fig — Chicago Hardy", format: "1gal, case of 12", unit_price_cents: 26400, min_order_qty: 1, available_qty: 0, lead_time_weeks: 8 },
    { id: "ws_05", species_name: "Muscadine", format: "38-cell tray", unit_price_cents: 19800, min_order_qty: 2, available_qty: 3, lead_time_weeks: 12 },
  ],
  buyer_requests: [
    { id: "wr_01", buyer_name: "Piedmont Restoration LLC", org_type: "Restoration contractor", species_name: "Elderberry", qty: 600, state: "VA", requested_at: "2026-06-24T00:00:00Z", status: "new", notes: "Streambank buffer planting, fall install. Asking about DOT-spec paperwork." },
    { id: "wr_02", buyer_name: "Rooted Goods Co-op", org_type: "Garden center", species_name: "Rosemary", qty: 200, state: "NC", requested_at: "2026-06-21T00:00:00Z", status: "quoted" },
    { id: "wr_03", buyer_name: "City of Decatur Parks", org_type: "Municipal", species_name: "Beautyberry", qty: 350, state: "GA", requested_at: "2026-06-15T00:00:00Z", status: "accepted", notes: "Phase 2 pollinator corridor." },
    { id: "wr_04", buyer_name: "Bluebird Farmscapes", org_type: "Landscaper", species_name: "Fig — Chicago Hardy", qty: 48, state: "TN", requested_at: "2026-06-10T00:00:00Z", status: "declined", notes: "Needed delivery before July — out of stock." },
  ],
}

// ── Network (hub only) ──────────────────────────────────────────────────────

export const MOCK_NETWORK: NetworkData = {
  totals: {
    units_this_month: 212,
    gross_cents: 986000,
    grower_pool_cents: 719780,
    hub_net_cents: 266220,
  },
  nodes: MOCK_NETWORK_HEALTH,
  transfers: [
    { id: "tr_01", from_node: "GA", to_node: "NC", species_name: "Rosemary 4in", qty: 40, status: "in_transit", updated_at: "2026-06-25T00:00:00Z" },
    { id: "tr_02", from_node: "FL", to_node: "GA", species_name: "Lychee airlayers", qty: 4, status: "requested", updated_at: "2026-06-24T00:00:00Z" },
    { id: "tr_03", from_node: "GA", to_node: "VA", species_name: "Elderberry plug tray", qty: 2, status: "received", updated_at: "2026-06-18T00:00:00Z" },
  ],
  onboarding: [
    { id: "app_01", applicant_name: "K. Deloach (Athens, GA)", state: "GA", stage: "trial_batch", applied_at: "2026-05-12T00:00:00Z" },
    { id: "app_02", applicant_name: "Wren Hollow Nursery", state: "AL", stage: "interview", applied_at: "2026-06-08T00:00:00Z" },
    { id: "app_03", applicant_name: "T. Marsh", state: "SC", stage: "applied", applied_at: "2026-06-22T00:00:00Z" },
  ],
}

// ── Quests ──────────────────────────────────────────────────────────────────
// Mirrors GET /vendor/quests and GET /vendor/quests/enrollments. Catalog
// entries copy real quest keys/stages from
// backend/src/modules/vendor-quest/definitions so the mock→live flip is
// shape-identical.

function questDisclaimer(gatekeeper: string): string {
  return (
    `FBM assembles this documentation from your real operating history on the ` +
    `platform. It does not guarantee any outcome and does not fabricate ` +
    `records. ${gatekeeper} is the decision-maker; official forms and their ` +
    `review are the actual gate. Verify every figure before submitting.`
  )
}

export const MOCK_QUEST_CATALOG: QuestCatalogEntry[] = [
  {
    key: "fsa-farm-loan",
    category: "Capital & Funding",
    title: "FSA Farm Loan Readiness",
    outcome: "USDA FSA Microloan / Down Payment loan application readiness",
    type: "individual",
    gatekeeper: "your FSA loan officer",
    disclaimer: questDisclaimer("Your FSA loan officer"),
    health_claims_guardrail: false,
    uses_fields: ["inventory", "production", "documents", "channels"],
    has_packet: true,
    requirements: [
      { key: "management_history", label: "Farm management history", tag: "platform", needs: ["production"] },
      { key: "revenue_record", label: "Revenue record", tag: "platform", needs: [] },
      { key: "balance_sheet", label: "Balance sheet", tag: "assisted", needs: ["inventory"], note: "Drafted from inventory valuation + payout history." },
      { key: "farm_plan", label: "Farm operating plan", tag: "vendor-supplied", needs: [] },
      { key: "fsa_forms", label: "FSA forms & eligibility", tag: "outside-fbm", needs: [], note: "Filed directly with your county FSA office." },
    ],
    stages: [
      { key: "operating", label: "Operating", order: 1 },
      { key: "documented", label: "Documented", order: 2 },
      { key: "loan_ready", label: "Loan-Ready", order: 3 },
    ],
  },
  {
    key: "grant-readiness",
    category: "Capital & Funding",
    title: "Grant Readiness",
    outcome: "Grant application packet (narrative + financial exhibits)",
    type: "individual",
    gatekeeper: "the granting agency",
    disclaimer: questDisclaimer("The granting agency"),
    health_claims_guardrail: false,
    uses_fields: ["production", "inventory", "documents"],
    has_packet: true,
    requirements: [
      { key: "operating_history", label: "Operating history", tag: "platform", needs: [] },
      { key: "financial_exhibits", label: "Financial exhibits", tag: "platform", needs: [] },
      { key: "narrative", label: "Project narrative", tag: "assisted", needs: ["production"], note: "Drafted from your propagation record; you edit." },
      { key: "grant_forms", label: "Agency forms", tag: "outside-fbm", needs: [] },
    ],
    stages: [
      { key: "eligible", label: "Eligible", order: 1 },
      { key: "documented", label: "Documented", order: 2 },
      { key: "grant_ready", label: "Grant-Ready", order: 3 },
    ],
  },
  {
    key: "wholesale-account",
    category: "Market Access & Growth",
    title: "Wholesale Account Readiness",
    outcome: "Qualify to sell to shops / co-ops / distributors",
    type: "individual",
    gatekeeper: "the buyer / retail account",
    disclaimer: questDisclaimer("The wholesale buyer or retail account"),
    health_claims_guardrail: false,
    uses_fields: ["inventory", "channels", "documents"],
    has_packet: true,
    requirements: [
      { key: "fulfillment_reliability", label: "Fulfillment reliability", tag: "platform", needs: [] },
      { key: "capacity", label: "Capacity / volume history", tag: "platform", needs: [] },
      { key: "line_sheet", label: "Line sheet", tag: "assisted", needs: ["channels"], note: "Drafted from your listings + channel pricing." },
      { key: "insurance", label: "Insurance", tag: "vendor-supplied", needs: ["documents"], note: "Upload a certificate of insurance." },
      { key: "samples_certs", label: "Samples / certifications", tag: "vendor-supplied", needs: ["documents"], note: "Provide on request." },
    ],
    stages: [
      { key: "operating", label: "Operating", order: 1 },
      { key: "reliable", label: "Reliable", order: 2 },
      { key: "wholesale_ready", label: "Wholesale-Ready", order: 3 },
    ],
  },
  {
    key: "market-vendor",
    category: "Market Access & Growth",
    title: "Market / Co-op Vendor Application",
    outcome: "Farmers-market stall or co-op vendor membership",
    type: "individual",
    gatekeeper: "the market manager / co-op",
    disclaimer: questDisclaimer("The market manager or co-op"),
    health_claims_guardrail: false,
    uses_fields: ["production", "documents"],
    has_packet: true,
    requirements: [
      { key: "product_record", label: "Product & production record", tag: "platform", needs: ["production"] },
      { key: "sales_history", label: "Sales history", tag: "platform", needs: [] },
      { key: "application", label: "Vendor application", tag: "assisted", needs: [] },
      { key: "market_fees", label: "Stall fees & attendance", tag: "outside-fbm", needs: [] },
    ],
    stages: [
      { key: "listed", label: "Listed", order: 1 },
      { key: "documented", label: "Documented", order: 2 },
      { key: "application_ready", label: "Application-Ready", order: 3 },
    ],
  },
  {
    key: "compliance-tracker",
    category: "Certification & Trust",
    title: "Compliance / Certification Tracker",
    outcome: "Certification-ready document set (gaps flagged)",
    type: "individual",
    gatekeeper: "the certifier / health department",
    disclaimer: questDisclaimer("The certifier or health department"),
    health_claims_guardrail: true,
    uses_fields: ["production", "documents"],
    has_packet: true,
    requirements: [
      { key: "production_log", label: "Production log", tag: "platform", needs: ["production"] },
      { key: "documents", label: "Licenses & certificates", tag: "vendor-supplied", needs: ["documents"], note: "Nursery license, phyto certs — stored in the vault." },
      { key: "inspection", label: "Inspection", tag: "outside-fbm", needs: [], note: "Scheduled with your state department of agriculture." },
    ],
    stages: [
      { key: "started", label: "Started", order: 1 },
      { key: "documented", label: "Documented", order: 2 },
      { key: "cert_ready", label: "Certification-Ready", order: 3 },
    ],
  },
  {
    key: "coop-formation",
    category: "Cooperative & Mission",
    title: "Co-op Formation Readiness",
    outcome: "Combined member records assembled to form a cooperative",
    type: "collective",
    gatekeeper: "your co-op's incorporation process and members",
    disclaimer: questDisclaimer("Your co-op's incorporation body and members"),
    health_claims_guardrail: false,
    uses_fields: ["documents"],
    has_packet: true,
    requirements: [
      { key: "member_operating_records", label: "Member operating records", tag: "platform", needs: [], note: "Aggregated only from consenting members." },
      { key: "combined_financials", label: "Combined financials", tag: "assisted", needs: [] },
      { key: "bylaws", label: "Bylaws & incorporation filing", tag: "outside-fbm", needs: [] },
    ],
    stages: [
      { key: "forming", label: "Forming", order: 1 },
      { key: "documented", label: "Documented", order: 2 },
      { key: "formation_ready", label: "Formation-Ready", order: 3 },
    ],
  },
]

export const MOCK_QUEST_ENROLLMENTS: QuestEnrollmentItem[] = [
  {
    enrollment: {
      id: "enr_01",
      seller_id: "node_ga",
      quest_key: "wholesale-account",
      status: "ACTIVE",
      current_stage: 1,
      collective_id: null,
      enrolled_at: "2026-05-02T00:00:00Z",
      dropped_at: null,
      completed_at: null,
    },
    evaluation: {
      quest_key: "wholesale-account",
      stages: [
        { key: "operating", label: "Operating", order: 1, open: true, missing: [] },
        { key: "reliable", label: "Reliable", order: 2, open: false, missing: ["20 fulfilled orders"] },
        { key: "wholesale_ready", label: "Wholesale-Ready", order: 3, open: false, missing: ["50 fulfilled orders (capacity)", "5 active listings for a line sheet"] },
      ],
      current_stage_index: 1,
      current_stage_key: "operating",
      final_gate_open: false,
      packet_available: false,
      requirements: [
        { key: "fulfillment_reliability", label: "Fulfillment reliability", tag: "platform", status: "satisfied" },
        { key: "capacity", label: "Capacity / volume history", tag: "platform", status: "unsatisfied" },
        { key: "line_sheet", label: "Line sheet", tag: "assisted", status: "satisfied", note: "Drafted from your listings + channel pricing." },
        { key: "insurance", label: "Insurance", tag: "vendor-supplied", status: "checklist", note: "Upload a certificate of insurance." },
        { key: "samples_certs", label: "Samples / certifications", tag: "vendor-supplied", status: "checklist", note: "Provide on request." },
      ],
    },
  },
  {
    enrollment: {
      id: "enr_02",
      seller_id: "node_ga",
      quest_key: "market-vendor",
      status: "COMPLETE",
      current_stage: 3,
      collective_id: null,
      enrolled_at: "2026-02-10T00:00:00Z",
      dropped_at: null,
      completed_at: "2026-04-28T00:00:00Z",
    },
    evaluation: null, // backend only evaluates ACTIVE enrollments
  },
]
