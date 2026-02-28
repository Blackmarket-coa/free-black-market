import { model } from "@medusajs/framework/utils";

export const ReconciliationAlert = model.define("reconciliation_alert", {
  id: model.id().primaryKey(),
  storefront_id: model.text(),
  start_date: model.dateTime(),
  end_date: model.dateTime(),
  severity: model.text().default("high"),
  message: model.text(),
  details: model.json().nullable(),
});
