import { model } from "@medusajs/framework/utils"

export enum BackingMode {
  PRE_ORDER = "PRE_ORDER",
  MICRO_INVESTOR = "MICRO_INVESTOR",
}

const Backing = model.define("collective_backing", {
  id: model.id().primaryKey(),
  campaign_id: model.text(),
  backer_id: model.text(),
  mode: model.enum(Object.values(BackingMode)),
  amount: model.bigNumber(),
  units_reserved: model.number().nullable(),
  investor_pool_share: model.float().default(0),
  payout_cap_amount: model.bigNumber().nullable(),
  payout_released_amount: model.bigNumber().default(0),
  status: model.enum(["PLEDGED", "REFUNDED", "SETTLED"]).default("PLEDGED"),
  metadata: model.json().nullable(),
}).indexes([
  { on: ["campaign_id"], name: "IDX_collective_backing_campaign_id" },
  { on: ["backer_id"], name: "IDX_collective_backing_backer_id" },
])

export default Backing
