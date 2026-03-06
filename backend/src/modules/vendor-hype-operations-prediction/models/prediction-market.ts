import { model } from "@medusajs/framework/utils"

export enum PredictionMode {
  NON_CASH = "non_cash",
  SWEEPSTAKES = "sweepstakes",
  REGULATED_CASH = "regulated_cash",
}

export enum PredictionMarketState {
  DRAFT = "draft",
  SCHEDULED = "scheduled",
  OPEN = "open",
  LOCKED = "locked",
  IN_REVIEW = "in_review",
  SETTLED = "settled",
  VOIDED = "voided",
}

const PredictionMarket = model
  .define("prediction_market", {
    id: model.id().primaryKey(),
    profile_id: model.text(),
    milestone_id: model.text().nullable(),
    title: model.text().searchable(),
    description: model.text().nullable(),
    mode: model.enum(Object.values(PredictionMode)).default(PredictionMode.NON_CASH),
    jurisdiction_code: model.text(),
    policy_version: model.text(),
    oracle_config_id: model.text(),
    starts_at: model.dateTime(),
    locks_at: model.dateTime(),
    settlement_deadline_at: model.dateTime().nullable(),
    payout_cap_config: model.json().nullable(),
    state: model
      .enum(Object.values(PredictionMarketState))
      .default(PredictionMarketState.DRAFT),
    created_by: model.text(),
    metadata: model.json().nullable(),
  })
  .indexes([
    { on: ["profile_id"], name: "IDX_prediction_market_profile" },
    { on: ["state"], name: "IDX_prediction_market_state" },
    {
      on: ["jurisdiction_code", "mode", "state"],
      name: "IDX_prediction_market_policy_gate",
    },
  ])

export default PredictionMarket
