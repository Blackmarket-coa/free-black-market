import { model } from "@medusajs/framework/utils"

export enum SupplierContactMethod {
  EMAIL = "email",
  API = "api",
  MANUAL = "manual",
}

const SupplierProfile = model.define("supplier_profile", {
  id: model.id().primaryKey(),
  supplier_id: model.text().unique(),
  display_name: model.text(),
  contact_method: model
    .enum(Object.values(SupplierContactMethod))
    .default(SupplierContactMethod.EMAIL),
  contact_email: model.text().nullable(),
  api_base_url: model.text().nullable(),
  api_key: model.text().nullable(),
  is_active: model.boolean().default(true),
  metadata: model.json().nullable(),
})

export default SupplierProfile
