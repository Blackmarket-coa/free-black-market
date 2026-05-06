import { model } from "@medusajs/framework/utils"

export enum OrderSubcontractStatus {
  PROPOSED = "proposed",
  ACCEPTED = "accepted",
  IN_PROGRESS = "in_progress",
  DELIVERED = "delivered",
  ACCEPTED_BY_PARENT = "accepted_by_parent",
  DISPUTED = "disputed",
  CANCELED = "canceled",
}

const OrderSubcontract = model
  .define("order_subcontract", {
    id: model.id().primaryKey(),

    // Parent order from the storefront
    parent_order_id: model.text(),
    parent_seller_id: model.text(),

    // Service vendor doing the work
    subcontract_seller_id: model.text(),

    // Backing service contract (and program)
    contract_id: model.text(),
    program_id: model.text().nullable(),

    // Which line items are subcontracted (json array of order item ids)
    order_item_ids: model.json(),
    unit_count: model.number(),
    unit_price_cents: model.number(),
    currency_code: model.text().default("usd"),
    total_cents: model.bigNumber(),

    status: model
      .enum(Object.values(OrderSubcontractStatus))
      .default(OrderSubcontractStatus.PROPOSED),

    pickup_at: model.dateTime().nullable(),
    deliver_to: model.json().nullable(), // address json — buyer's or parent's

    escrow_ledger_entry_id: model.text().nullable(),
    release_ledger_entry_id: model.text().nullable(),

    dispute_reason: model.text().nullable(),

    metadata: model.json().nullable(),
  })
  .indexes([
    {
      on: ["parent_order_id"],
      name: "IDX_subcontract_parent_order",
    },
    {
      on: ["subcontract_seller_id", "status"],
      name: "IDX_subcontract_seller_status",
    },
    {
      on: ["parent_seller_id", "status"],
      name: "IDX_subcontract_parent_seller_status",
    },
    {
      on: ["contract_id"],
      name: "IDX_subcontract_contract",
    },
  ])

export default OrderSubcontract
