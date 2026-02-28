import { model } from "@medusajs/framework/utils"

const Storefront = model.define("tenancy_storefront", {
  id: model.id().primaryKey(),
  organization_id: model.text(),
  name: model.text(),
  slug: model.text().unique(),
  tier: model.enum(["tier0_public", "tier1_verified", "tier2_aligned_org"]).default("tier0_public"),
  metadata: model.json().nullable(),
})

export default Storefront
