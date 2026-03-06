import { model } from "@medusajs/framework/utils"

export enum PredictionSettlementStatus {
  PROPOSED = "proposed",
  FINAL = "final",
  REVERSED = "reversed",
}

const PredictionSettlement = model
  .define("prediction_settlement", {
    id: model.id().primaryKey(),
    market_id: model.text(),
    settlement_ref: model.text(),
    oracle_outcome_key: model.text(),
    oracle_evidence_uri: model.text(),
    settled_at: model.dateTime(),
    dispute_window_ends_at: model.dateTime().nullable(),
    status: model
      .enum(Object.values(PredictionSettlementStatus))
      .default(PredictionSettlementStatus.PROPOSED),
    executed_by: model.enum(["system", "operator"]).default("system"),
    execution_run_id: model.text(),
    metadata: model.json().nullable(),
  })
  .indexes([
    { on: ["market_id"], name: "IDX_prediction_settlement_market" },
    { on: ["settlement_ref"], name: "IDX_prediction_settlement_ref" },
  ])

export default PredictionSettlement
