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
    split_pct: 73,
    net_cents: 300760,
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
    { id: "p_05", month: "2026-05", units_sold: 78, gross_cents: 366000, split_pct: 73, net_cents: 267180, paid_at: "2026-06-05", transfer_ref: "ach_5f2a" },
    { id: "p_04", month: "2026-04", units_sold: 64, gross_cents: 298000, split_pct: 70, net_cents: 208600, paid_at: "2026-05-05", transfer_ref: "ach_4b18" },
    { id: "p_03", month: "2026-03", units_sold: 51, gross_cents: 233000, split_pct: 70, net_cents: 163100, paid_at: "2026-04-05", transfer_ref: "ach_3c77" },
  ],
  split_breakdown: [
    { product_name: "Pineapple guava 1gal", units: 28, gross_cents: 154000, your_cut_cents: 112420 },
    { product_name: "Rosemary 4in", units: 40, gross_cents: 96000, your_cut_cents: 70080 },
    { product_name: "Banana 2gal", units: 12, gross_cents: 88000, your_cut_cents: 64240 },
    { product_name: "Mulberry 1gal", units: 6, gross_cents: 74000, your_cut_cents: 54020 },
  ],
  earnings_ytd_cents: 939640,
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
