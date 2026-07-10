"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const utils_1 = require("@medusajs/framework/utils");
const woocommerce_import_log_1 = require("./woocommerce-import-log");
const WooCommerceConnection = utils_1.model.define("woocommerce_connection", {
    id: utils_1.model.id().primaryKey(),
    seller_id: utils_1.model.text().unique(),
    store_url: utils_1.model.text(),
    consumer_key: utils_1.model.text(),
    consumer_secret: utils_1.model.text(),
    store_name: utils_1.model.text().nullable(),
    currency: utils_1.model.text().nullable(),
    sync_inventory: utils_1.model.boolean().default(true),
    last_synced_at: utils_1.model.dateTime().nullable(),
    last_sync_report: utils_1.model.json().nullable(),
    import_logs: utils_1.model.hasMany(() => woocommerce_import_log_1.default, {
        mappedBy: "connection",
    }),
    metadata: utils_1.model.json().nullable(),
})
    .indexes([
    { on: ["seller_id"], name: "IDX_woo_connection_seller_id" },
])
    .cascades({
    delete: ["import_logs"],
});
exports.default = WooCommerceConnection;
