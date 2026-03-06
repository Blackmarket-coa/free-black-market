import { model } from "@medusajs/framework/utils"

export enum PurchaseOrderStatus {
  PENDING = "PENDING",
  AUTO_EXECUTED = "AUTO_EXECUTED",
  MANUAL_ACTION_REQUIRED = "MANUAL_ACTION_REQUIRED",
  ORDERED = "ORDERED",
  SHIPPED = "SHIPPED",
  DELIVERED = "DELIVERED",
}

const PurchaseOrder = model.define("collective_purchase_order", {
  id: model.id().primaryKey(),
  campaign_id: model.text(),
  material_line_item_id: model.text().nullable(),
  supplier_url: model.text(),
  status: model.enum(Object.values(PurchaseOrderStatus)).default(PurchaseOrderStatus.PENDING),
  budget_amount: model.bigNumber(),
  actual_amount: model.bigNumber().nullable(),
  order_confirmation: model.text().nullable(),
  tracking_number: model.text().nullable(),
  carrier: model.text().nullable(),
  eta: model.dateTime().nullable(),
  delivery_status: model.text().nullable(),
  receipt_data: model.json().nullable(),
  metadata: model.json().nullable(),
}).indexes([
  { on: ["campaign_id"], name: "IDX_collective_po_campaign_id" },
  { on: ["status"], name: "IDX_collective_po_status" },
])

export default PurchaseOrder
