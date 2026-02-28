import { model } from "@medusajs/framework/utils"

export enum ManualFulfillmentStatus {
  PENDING = "pending",
  ACKNOWLEDGED = "acknowledged",
  IN_PROGRESS = "in_progress",
  SHIPPED = "shipped",
  DELIVERED = "delivered",
  CANCELED = "canceled",
}

const ManualFulfillmentUpdate = model.define("manual_fulfillment_update", {
  id: model.id().primaryKey(),
  order_id: model.text(),
  supplier_id: model.text(),
  status: model
    .enum(Object.values(ManualFulfillmentStatus))
    .default(ManualFulfillmentStatus.PENDING),
  notes: model.text().nullable(),
  source: model.text().default("manual"),
  metadata: model.json().nullable(),
})

export default ManualFulfillmentUpdate
