import { model } from "@medusajs/framework/utils"

export enum ForwardingAttemptStatus {
  PENDING = "pending",
  RETRYING = "retrying",
  FORWARDED = "forwarded",
  FAILED = "failed",
  DEAD_LETTER = "dead_letter",
}

const ForwardingAttempt = model.define("supplier_forwarding_attempt", {
  id: model.id().primaryKey(),
  order_id: model.text(),
  supplier_id: model.text(),
  status: model
    .enum(Object.values(ForwardingAttemptStatus))
    .default(ForwardingAttemptStatus.PENDING),
  retry_count: model.number().default(0),
  last_error: model.text().nullable(),
  payload: model.json().nullable(),
  forwarded_at: model.dateTime().nullable(),
  next_retry_at: model.dateTime().nullable(),
}).indexes([
  { on: ["order_id"], name: "IDX_supplier_forwarding_order" },
  { on: ["status"], name: "IDX_supplier_forwarding_status" },
])

export default ForwardingAttempt
