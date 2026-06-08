import { model } from "@medusajs/framework/utils"

export enum OpportunitySubjectType {
  CATEGORY = "CATEGORY",
  PRODUCT = "PRODUCT",
}

/**
 * A materialized opportunity score for a subject (a category, or a specific
 * product) in a region, recomputed by the `recompute-opportunity-scores` job
 * from live demand / competition / startup-cost signals.
 */
const OpportunityScore = model
  .define("opportunity_score", {
    id: model.id().primaryKey(),

    subject_type: model
      .enum(Object.values(OpportunitySubjectType))
      .default(OpportunitySubjectType.CATEGORY),
    /** category slug, or product id, depending on subject_type. */
    subject_key: model.text().searchable(),
    subject_label: model.text().nullable(),
    region: model.text().default("US"),

    // 0..1 normalized inputs.
    demand_score: model.float().default(0),
    competition_score: model.float().default(0),
    startup_cost_score: model.float().default(0),

    // 0..10 composite (spec's "9.1").
    composite: model.float().default(0),

    /** Raw signal snapshot + human-readable bands for the opportunity page. */
    signals: model.json().nullable(),

    computed_at: model.dateTime(),

    metadata: model.json().nullable(),
  })
  .indexes([
    {
      on: ["subject_type", "subject_key", "region"],
      name: "IDX_opportunity_score_subject",
      unique: true,
    },
    { on: ["composite"], name: "IDX_opportunity_score_composite" },
    { on: ["region"], name: "IDX_opportunity_score_region" },
  ])

export default OpportunityScore
