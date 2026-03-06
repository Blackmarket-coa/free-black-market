import { model } from "@medusajs/framework/utils"

export enum PredictionPayoutStatus {
  COMPUTED = "computed",
  CREDITED = "credited",
  FAILED = "failed",
  RETRIED = "retried",
  REVERSED = "reversed",
}

const PredictionPayoutEntry = model
  .define("prediction_payout_entry", {
    id: model.id().primaryKey(),
    settlement_id: model.text(),
    market_id: model.text(),
    position_id: model.text(),
    supporter_id: model.text(),
    payout_amount: model.bigNumber().default(0),
    payout_unit: model.enum(["points", "currency"]).default("points"),
    payout_status: model
      .enum(Object.values(PredictionPayoutStatus))
      .default(PredictionPayoutStatus.COMPUTED),
    is_winner: model.boolean().default(false),
    failure_reason: model.text().nullable(),
    metadata: model.json().nullable(),
  })
  .indexes([
    { on: ["settlement_id"], name: "IDX_prediction_payout_settlement" },
    { on: ["market_id", "supporter_id"], name: "IDX_prediction_payout_market_supporter" },
    { on: ["payout_status"], name: "IDX_prediction_payout_status" },
    { on: ["settlement_id", "position_id"], name: "IDX_prediction_payout_unique_position" },
  ])

export default PredictionPayoutEntry
