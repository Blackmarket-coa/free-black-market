import { model } from "@medusajs/framework/utils"

const DonationSettings = model.define("donation_settings", {
  id: model.id().primaryKey(),
  is_default: model.boolean().default(true),
  settlement_mode: model.enum(["split_processor", "ledger_batch"]).default("split_processor"),
  default_percentage: model.number().default(2),
  round_up_enabled: model.boolean().default(true),
  metadata: model.json().nullable(),
})

export default DonationSettings
