"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const utils_1 = require("@medusajs/framework/utils");
const types_1 = require("../types");
const woocommerce_connection_1 = require("./woocommerce-connection");
const WooCommerceImportLog = utils_1.model.define("woocommerce_import_log", {
    id: utils_1.model.id().primaryKey(),
    connection: utils_1.model.belongsTo(() => woocommerce_connection_1.default, {
        mappedBy: "import_logs",
    }),
    status: utils_1.model.enum(types_1.ImportStatus).default(types_1.ImportStatus.PENDING),
    total_products: utils_1.model.number().default(0),
    imported_count: utils_1.model.number().default(0),
    failed_count: utils_1.model.number().default(0),
    skipped_count: utils_1.model.number().default(0),
    import_as_draft: utils_1.model.boolean().default(true),
    error_details: utils_1.model.json().nullable(),
    started_at: utils_1.model.dateTime().nullable(),
    completed_at: utils_1.model.dateTime().nullable(),
    metadata: utils_1.model.json().nullable(),
})
    .indexes([
    { on: ["status"], name: "IDX_woo_import_log_status" },
]);
exports.default = WooCommerceImportLog;
