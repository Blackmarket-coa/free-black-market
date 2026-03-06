import { model } from "@medusajs/framework/utils"

export enum PredictionStakeUnit {
  POINTS = "points",
  CURRENCY = "currency",
}

export enum PredictionPositionStatus {
  OPEN = "open",
  WON = "won",
  LOST = "lost",
  VOIDED = "voided",
}

const PredictionPosition = model
  .define("prediction_position", {
    id: model.id().primaryKey(),
    market_id: model.text(),
    supporter_id: model.text(),
    outcome_option_key: model.text(),
    stake_amount: model.bigNumber(),
    stake_unit: model
      .enum(Object.values(PredictionStakeUnit))
      .default(PredictionStakeUnit.POINTS),
    max_payout_amount: model.bigNumber().nullable(),
    status: model
      .enum(Object.values(PredictionPositionStatus))
      .default(PredictionPositionStatus.OPEN),
    idempotency_key: model.text(),
    metadata: model.json().nullable(),
  })
  .indexes([
    { on: ["market_id"], name: "IDX_prediction_position_market" },
    { on: ["supporter_id"], name: "IDX_prediction_position_supporter" },
    {
      on: ["market_id", "supporter_id", "idempotency_key"],
      name: "IDX_prediction_position_idempotency",
    },
  ])

export default PredictionPosition
