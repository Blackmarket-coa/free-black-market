import { model } from "@medusajs/framework/utils"

export enum VendorReputationTier {
  TIER_1 = "TIER_1",
  TIER_2 = "TIER_2",
  TIER_3 = "TIER_3",
  TIER_4 = "TIER_4",
}

const VendorReputation = model.define("collective_vendor_reputation", {
  id: model.id().primaryKey(),
  vendor_id: model.text(),
  tier: model.enum(Object.values(VendorReputationTier)).default(VendorReputationTier.TIER_1),
  campaign_cap: model.bigNumber().nullable(),
  unresolved_disputes_in_row: model.number().default(0),
  total_disputes: model.number().default(0),
  suspended: model.boolean().default(false),
  metadata: model.json().nullable(),
}).indexes([
  { on: ["vendor_id"], name: "IDX_collective_vendor_reputation_vendor_id" },
])

export default VendorReputation
