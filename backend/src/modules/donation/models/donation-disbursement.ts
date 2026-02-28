import { model } from "@medusajs/framework/utils"

const DonationDisbursement = model.define("donation_disbursement", {
  id: model.id().primaryKey(),
  beneficiary_id: model.text(),
  storefront_id: model.text().default("default"),
  amount: model.bigNumber(),
  currency_code: model.text().default("usd"),
  status: model.enum(["pending", "sent", "failed"]).default("pending"),
  period_start: model.dateTime(),
  period_end: model.dateTime(),
  metadata: model.json().nullable(),
})

export default DonationDisbursement
