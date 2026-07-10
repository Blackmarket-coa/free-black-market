import { model } from "@medusajs/framework/utils"
import { OdooImportStatus } from "../types"

/**
 * A single Odoo import run. `connection_id` links it to its odoo_connection
 * (kept as a plain column + index rather than a relation, to avoid a two-way
 * model dependency). At most one active (pending/in_progress) log per connection
 * is enforced by a partial unique index in the migration.
 */
const OdooImportLog = model.define("odoo_import_log", {
  id: model.id().primaryKey(),
  connection_id: model.text(),
  status: model.enum(OdooImportStatus).default(OdooImportStatus.PENDING),
  total_products: model.number().default(0),
  imported_count: model.number().default(0),
  updated_count: model.number().default(0),
  failed_count: model.number().default(0),
  skipped_count: model.number().default(0),
  import_as_draft: model.boolean().default(true),
  error_details: model.json().nullable(),
  started_at: model.dateTime().nullable(),
  completed_at: model.dateTime().nullable(),
  metadata: model.json().nullable(),
})
  .indexes([
    { on: ["connection_id"], name: "IDX_odoo_import_log_connection_id" },
    { on: ["status"], name: "IDX_odoo_import_log_status" },
  ])

export default OdooImportLog
