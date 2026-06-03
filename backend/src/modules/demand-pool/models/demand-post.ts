import { model } from "@medusajs/framework/utils"

export enum DemandPostStatus {
  DRAFT = "DRAFT",
  OPEN = "OPEN",
  THRESHOLD_MET = "THRESHOLD_MET",
  NEGOTIATING = "NEGOTIATING",
  DEAL_APPROVED = "DEAL_APPROVED",
  ORDER_PLACED = "ORDER_PLACED",
  FULFILLED = "FULFILLED",
  CANCELLED = "CANCELLED",
  EXPIRED = "EXPIRED",
}

export enum DemandPostVisibility {
  PUBLIC = "PUBLIC",
  NETWORK_ONLY = "NETWORK_ONLY",
  INVITE_ONLY = "INVITE_ONLY",
}

const DemandPost = model.define("demand_post", {
  id: model.id().primaryKey(),

  // Creator
  creator_id: model.text(),
  creator_type: model.enum(["CUSTOMER", "SELLER"]).default("CUSTOMER"),

  // Product description
  title: model.text().searchable(),
  description: model.text(),
  category: model.text().nullable(),
  specs: model.json().nullable(),

  // Quantity & pricing targets
  target_quantity: model.number(),
  min_quantity: model.number(),
  committed_quantity: model.number().default(0),
  unit_of_measure: model.text().default("units"),
  target_price: model.bigNumber().nullable(),
  currency_code: model.text().default("USD"),

  // Location & delivery
  delivery_region: model.text().nullable(),
  delivery_address: model.json().nullable(),
  delivery_window_start: model.dateTime().nullable(),
  delivery_window_end: model.dateTime().nullable(),

  // Timing
  deadline: model.dateTime().nullable(),
  deadline_type: model.enum(["HARD", "SOFT"]).default("SOFT"),

  // Status & visibility
  status: model
    .enum(Object.values(DemandPostStatus))
    .default(DemandPostStatus.DRAFT),
  visibility: model
    .enum(Object.values(DemandPostVisibility))
    .default(DemandPostVisibility.PUBLIC),

  // Bounty aggregate
  total_bounty_amount: model.bigNumber().default(0),
  total_escrowed: model.bigNumber().default(0),

  // Scoring for supplier discovery
  attractiveness_score: model.float().default(0),

  // Approved supplier & final price
  selected_supplier_id: model.text().nullable(),
  final_unit_price: model.bigNumber().nullable(),
  final_total_price: model.bigNumber().nullable(),

  // Hawala integration
  escrow_account_id: model.text().nullable(),

  // Reuse
  parent_demand_id: model.text().nullable(),
  recurring_rule: model.text().nullable(),
  is_template: model.boolean().default(false),

  // Ecosystem growth-loop linkage
  // A coalition (cooperative) this need/marketing bounty belongs to. Nullable
  // preserves the standalone demand-post behavior.
  cooperative_id: model.text().nullable(),
  // Groups every artifact created by a single Launch run (idempotency/tracing).
  launch_id: model.text().nullable(),
  // The Medusa product this marketing bounty promotes (set by Launch).
  product_id: model.text().nullable(),

  metadata: model.json().nullable(),
}).indexes([
  { on: ["status"], name: "IDX_demand_post_status" },
  { on: ["creator_id"], name: "IDX_demand_post_creator" },
  { on: ["category"], name: "IDX_demand_post_category" },
  { on: ["delivery_region"], name: "IDX_demand_post_region" },
  { on: ["visibility", "status"], name: "IDX_demand_post_visibility_status" },
  {
    on: ["attractiveness_score"],
    name: "IDX_demand_post_attractiveness",
  },
  { on: ["cooperative_id"], name: "IDX_demand_post_cooperative" },
  { on: ["launch_id"], name: "IDX_demand_post_launch" },
])

export default DemandPost
