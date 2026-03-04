import { model } from "@medusajs/framework/utils"

export enum CampaignType {
  PRODUCTION_RUN = "PRODUCTION_RUN",
  PRODUCTIVE_ASSET = "PRODUCTIVE_ASSET",
}

export enum CampaignStatus {
  DRAFT = "DRAFT",
  ACTIVE = "ACTIVE",
  FUNDED = "FUNDED",
  SOURCING = "SOURCING",
  MATERIALS_RECEIVED = "MATERIALS_RECEIVED",
  PRODUCING = "PRODUCING",
  FULFILLING = "FULFILLING",
  SELLING = "SELLING",
  COMPLETE = "COMPLETE",
  ASSET_ACQUISITION = "ASSET_ACQUISITION",
  ESTABLISHMENT = "ESTABLISHMENT",
  YIELDING = "YIELDING",
  MATURE = "MATURE",
  FAILED = "FAILED",
  DISPUTED = "DISPUTED",
  WIND_DOWN = "WIND_DOWN",
}

const Campaign = model.define("collective_campaign", {
  id: model.id().primaryKey(),
  vendor_id: model.text(),
  name: model.text().searchable(),
  description: model.text(),
  media: model.json().nullable(),
  campaign_type: model.enum(Object.values(CampaignType)),
  status: model.enum(Object.values(CampaignStatus)).default(CampaignStatus.DRAFT),
  batch_minimum: model.number().nullable(),
  funding_goal_override: model.bigNumber().nullable(),
  maker_fee: model.bigNumber().default(0),
  estimated_production_days: model.number().nullable(),
  shipping_per_unit: model.bigNumber().default(0),
  pickup_enabled: model.boolean().default(false),
  return_cap_multiplier: model.bigNumber().default(2),
  asset_type: model.text().nullable(),
  productive_lifespan: model.text().nullable(),
  yield_per_cycle: model.bigNumber().nullable(),
  cycle_frequency: model.text().nullable(),
  time_to_first_yield_days: model.number().nullable(),
  compounding_profile: model.text().nullable(),
  projected_return_curve: model.json().nullable(),
  material_total: model.bigNumber().default(0),
  maker_fee_subtotal: model.bigNumber().default(0),
  platform_fee_subtotal: model.bigNumber().default(0),
  shipping_subtotal: model.bigNumber().default(0),
  campaign_goal: model.bigNumber().default(0),
  per_unit_backer_cost: model.bigNumber().default(0),
  total_backed_amount: model.bigNumber().default(0),
  pre_order_backed_amount: model.bigNumber().default(0),
  investor_backed_amount: model.bigNumber().default(0),
  maker_fee_released_amount: model.bigNumber().default(0),
  metadata: model.json().nullable(),
}).indexes([
  { on: ["vendor_id"], name: "IDX_collective_campaign_vendor_id" },
  { on: ["status"], name: "IDX_collective_campaign_status" },
  { on: ["campaign_type", "status"], name: "IDX_collective_campaign_type_status" },
])

export default Campaign
