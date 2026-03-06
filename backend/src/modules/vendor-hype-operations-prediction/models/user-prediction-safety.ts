import { model } from "@medusajs/framework/utils"

export enum SafetyRiskLevel {
  LOW = "low",
  MEDIUM = "medium",
  HIGH = "high",
}

const UserPredictionSafety = model
  .define("user_prediction_safety", {
    id: model.id().primaryKey(),
    supporter_id: model.text(),
    self_excluded_until: model.dateTime().nullable(),
    cooldown_until: model.dateTime().nullable(),
    daily_position_limit: model.number().default(20),
    daily_positions_count: model.number().default(0),
    daily_counter_date: model.text().nullable(),
    last_position_at: model.dateTime().nullable(),
    risk_level: model.enum(Object.values(SafetyRiskLevel)).default(SafetyRiskLevel.LOW),
    metadata: model.json().nullable(),
  })
  .indexes([
    { on: ["supporter_id"], name: "IDX_prediction_safety_supporter" },
    { on: ["risk_level"], name: "IDX_prediction_safety_risk" },
  ])

export default UserPredictionSafety
