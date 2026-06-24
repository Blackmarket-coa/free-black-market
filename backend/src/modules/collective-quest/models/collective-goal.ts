import { model } from "@medusajs/framework/utils"

/** What real aggregate a goal "thermometer" tracks. */
export enum GoalScopeType {
  /** Treasury / fundraising milestone (e.g. a collective-campaign total). */
  TREASURY = "TREASURY",
  /** Governance quorum (votes toward a proposal threshold). */
  QUORUM = "QUORUM",
  /** A category "food forest" pooling effort. */
  FOOD_FOREST = "FOOD_FOREST",
  /** A custom, manually-updated goal. */
  CUSTOM = "CUSTOM",
}

export enum GoalStatus {
  ACTIVE = "ACTIVE",
  COMPLETE = "COMPLETE",
}

/**
 * Collective Goal ("thermometer").
 *
 * A shared-progress bar toward a cooperative target. `current_value` is a
 * **cached snapshot recomputed from the owning module** (collective-campaign,
 * governance, …) via `query.graph` — never an independent re-sum — so the
 * thermometer reuses the source of truth (ADR-0004, "aggregate never duplicate").
 */
const CollectiveGoal = model.define("collective_goal", {
  id: model.id().primaryKey(),

  scope_type: model.enum(Object.values(GoalScopeType)),
  // Id of the source record this goal snapshots from (campaign_id, proposal_id…).
  scope_id: model.text().nullable(),

  // Optional den/cooperative this goal belongs to.
  den_id: model.text().nullable(),

  title: model.text(),
  description: model.text().nullable(),

  target_value: model.number(),
  current_value: model.number().default(0),
  unit: model.text().default("units"),

  status: model.enum(Object.values(GoalStatus)).default(GoalStatus.ACTIVE),

  // Leaderboards are opt-in per goal (ADR-0004); default off.
  opt_in_leaderboard: model.boolean().default(false),

  metadata: model.json().nullable(),
})
  .indexes([
    { on: ["scope_type", "scope_id"], name: "IDX_collective_goal_scope" },
    { on: ["den_id"], name: "IDX_collective_goal_den_id" },
  ])

export default CollectiveGoal
