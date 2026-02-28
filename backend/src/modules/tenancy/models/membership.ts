import { model } from "@medusajs/framework/utils"

const Membership = model.define("tenancy_membership", {
  id: model.id().primaryKey(),
  user_id: model.text(),
  organization_id: model.text(),
  storefront_id: model.text(),
  role: model.enum(["org_owner", "storefront_admin", "catalog_manager", "finance_viewer"]),
  metadata: model.json().nullable(),
})

export default Membership
