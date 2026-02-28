import { model } from "@medusajs/framework/utils"

const DonationBeneficiary = model.define("donation_beneficiary", {
  id: model.id().primaryKey(),
  name: model.text(),
  slug: model.text().unique(),
  description: model.text().nullable(),
  verification_status: model.enum(["pending", "verified", "rejected"]).default("pending"),
  website: model.text().nullable(),
  payout_reference: model.text().nullable(),
  metadata: model.json().nullable(),
})

export default DonationBeneficiary
