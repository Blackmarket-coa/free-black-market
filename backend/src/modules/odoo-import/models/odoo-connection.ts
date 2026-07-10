import { model } from "@medusajs/framework/utils"

/**
 * A vendor's connection to their Odoo instance. Credentials (url/db/username/
 * api_key) are stored encrypted at rest — decrypt only when instantiating the
 * Odoo API client. One connection per seller (unique seller_id).
 */
const OdooConnection = model.define("odoo_connection", {
  id: model.id().primaryKey(),
  seller_id: model.text().unique(),
  url: model.text(), // encrypted
  db_name: model.text(), // encrypted
  username: model.text(), // encrypted
  api_key: model.text(), // encrypted
  store_name: model.text().nullable(),
  currency: model.text().nullable(),
  last_import_at: model.dateTime().nullable(),
  last_import_report: model.json().nullable(),
  metadata: model.json().nullable(),
})

export default OdooConnection
