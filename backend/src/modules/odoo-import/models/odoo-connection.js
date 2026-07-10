"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const utils_1 = require("@medusajs/framework/utils");
/**
 * A vendor's connection to their Odoo instance. Credentials (url/db/username/
 * api_key) are stored encrypted at rest — decrypt only when instantiating the
 * Odoo API client. One connection per seller (unique seller_id).
 */
const OdooConnection = utils_1.model.define("odoo_connection", {
    id: utils_1.model.id().primaryKey(),
    seller_id: utils_1.model.text().unique(),
    url: utils_1.model.text(), // encrypted
    db_name: utils_1.model.text(), // encrypted
    username: utils_1.model.text(), // encrypted
    api_key: utils_1.model.text(), // encrypted
    store_name: utils_1.model.text().nullable(),
    currency: utils_1.model.text().nullable(),
    last_import_at: utils_1.model.dateTime().nullable(),
    last_import_report: utils_1.model.json().nullable(),
    metadata: utils_1.model.json().nullable(),
});
exports.default = OdooConnection;
