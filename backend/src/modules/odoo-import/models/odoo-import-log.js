"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const utils_1 = require("@medusajs/framework/utils");
const types_1 = require("../types");
/**
 * A single Odoo import run. `connection_id` links it to its odoo_connection
 * (kept as a plain column + index rather than a relation, to avoid a two-way
 * model dependency). At most one active (pending/in_progress) log per connection
 * is enforced by a partial unique index in the migration.
 */
const OdooImportLog = utils_1.model.define("odoo_import_log", {
    id: utils_1.model.id().primaryKey(),
    connection_id: utils_1.model.text(),
    status: utils_1.model.enum(types_1.OdooImportStatus).default(types_1.OdooImportStatus.PENDING),
    total_products: utils_1.model.number().default(0),
    imported_count: utils_1.model.number().default(0),
    updated_count: utils_1.model.number().default(0),
    failed_count: utils_1.model.number().default(0),
    skipped_count: utils_1.model.number().default(0),
    import_as_draft: utils_1.model.boolean().default(true),
    error_details: utils_1.model.json().nullable(),
    started_at: utils_1.model.dateTime().nullable(),
    completed_at: utils_1.model.dateTime().nullable(),
    metadata: utils_1.model.json().nullable(),
})
    .indexes([
    { on: ["connection_id"], name: "IDX_odoo_import_log_connection_id" },
    { on: ["status"], name: "IDX_odoo_import_log_status" },
]);
exports.default = OdooImportLog;
