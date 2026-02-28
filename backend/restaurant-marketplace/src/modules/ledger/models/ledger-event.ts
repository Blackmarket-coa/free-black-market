import { model } from "@medusajs/framework/utils";
import { LedgerEventType } from "../types";

export const LedgerEvent = model.define("ledger_event", {
  id: model.id().primaryKey(),
  storefront_id: model.text(),
  event_type: model.enum(LedgerEventType),
  amount: model.bigNumber(),
  currency_code: model.text().default("usd"),
  occurred_at: model.dateTime(),
  reference_id: model.text().nullable(),
  metadata: model.json().nullable(),
});
