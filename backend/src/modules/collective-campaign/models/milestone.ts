import { model } from "@medusajs/framework/utils"

/**
 * collective_campaign_milestone — a goal milestone as DATA on a shared-goal
 * campaign (the maker-fee release labels MATERIALS_RECEIVED | FULFILLMENT on a
 * production campaign are not milestones in this sense and are untouched).
 *
 * `target_amount_cents` is INTEGER CENTS of contributed total at which the
 * milestone is reached; `reached_at` is set by `recordParticipantContribution`
 * the first time the campaign total meets it, never by hand. `impact_summary`
 * is the host's statement of what reaching it did, surfaced by the joint
 * impact report.
 */
const Milestone = model
  .define("collective_campaign_milestone", {
    id: model.id({ prefix: "ccms" }).primaryKey(),
    campaign_id: model.text(),
    title: model.text(),
    target_amount_cents: model.number(),
    unit: model.text().default("USD"),
    sort_order: model.number().default(0),
    reached_at: model.dateTime().nullable(),
    impact_summary: model.text().nullable(),
    metadata: model.json().nullable(),
  })
  .indexes([
    { on: ["campaign_id"], name: "IDX_collective_campaign_milestone_campaign_id", where: "deleted_at IS NULL" },
    {
      on: ["campaign_id", "sort_order"],
      name: "IDX_collective_campaign_milestone_campaign_order",
      where: "deleted_at IS NULL",
    },
  ])

export default Milestone
