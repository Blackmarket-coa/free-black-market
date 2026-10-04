import { model } from "@medusajs/framework/utils"

export enum CampaignType {
  PRODUCTION_RUN = "PRODUCTION_RUN",
  PRODUCTIVE_ASSET = "PRODUCTIVE_ASSET",
}

/**
 * `goal_kind` discriminates a campaign that is a shared fundraising goal run by
 * a coalition of organisations (docs/BMC_SURVIVAL_PROGRAMS.md Phase 1 item 3)
 * from the two production kinds `campaign_type` names. It is a nullable TEXT
 * column rather than a third enum value: `ALTER TYPE ... ADD VALUE` cannot be
 * used inside the transaction MikroORM wraps a migration in on every Postgres
 * version, and the production version is unverified. `null` means a production
 * campaign and nothing else changes for those rows.
 *
 * A SHARED_GOAL campaign has no material lines, no maker fee and a platform fee
 * of 0 (Decision 1, 0% on donations). Its money is NEVER a `collective_backing`
 * and never touches the campaign escrow: contributions are direct charges on
 * each participant organisation's own connected account (donation module,
 * `donation_split_record.campaign_id`), and the Connect webhook reports them to
 * `recordParticipantContribution`. Posture A rule 10; legal checkpoints L24, L25.
 */
export const CAMPAIGN_GOAL_KIND_SHARED_GOAL = "SHARED_GOAL" as const
export type CampaignGoalKind = typeof CAMPAIGN_GOAL_KIND_SHARED_GOAL

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
  /** `"SHARED_GOAL"` for a coalition shared-goal campaign; null for a production campaign. */
  goal_kind: model.text().nullable(),
  /** The coalition's FBM face (`cooperative.id`) for a shared-goal campaign. */
  cooperative_id: model.text().nullable(),
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
  // Partial, mirroring Migration20261003SharedGoal exactly so `db:generate` stays quiet.
  { on: ["goal_kind"], name: "IDX_collective_campaign_goal_kind", where: "deleted_at IS NULL" },
  { on: ["cooperative_id"], name: "IDX_collective_campaign_cooperative_id", where: "deleted_at IS NULL" },
])

export default Campaign
