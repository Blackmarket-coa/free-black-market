import { model } from "@medusajs/framework/utils"

const YieldReport = model.define("collective_yield_report", {
  id: model.id().primaryKey(),
  campaign_id: model.text(),
  cycle_label: model.text(),
  measured_output: model.bigNumber(),
  payout_pool_amount: model.bigNumber().default(0),
  projected_next_cycle_output: model.bigNumber().nullable(),
  oracle_reference: model.text().nullable(),
  reported_at: model.dateTime(),
  metadata: model.json().nullable(),
}).indexes([
  { on: ["campaign_id"], name: "IDX_collective_yield_campaign_id" },
])

export default YieldReport
