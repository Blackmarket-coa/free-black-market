import { model } from "@medusajs/framework/utils"

const Organization = model.define("tenancy_organization", {
  id: model.id().primaryKey(),
  name: model.text(),
  slug: model.text().unique(),
  metadata: model.json().nullable(),
})

export default Organization
