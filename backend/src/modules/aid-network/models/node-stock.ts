import { model } from "@medusajs/framework/utils"

/** Where a lot came from. Not all inventory is bought. */
export enum StockSource {
  PURCHASED = "purchased",
  DONATED = "donated",
  /** Recovered from a retailer/producer before it was discarded. */
  RESCUED = "rescued",
  /** Gathered from a field or tree after the commercial harvest. */
  GLEANED = "gleaned",
  PRODUCED = "produced",
  TRANSFERRED = "transferred",
}

export enum StockStatus {
  AVAILABLE = "available",
  RESERVED = "reserved",
  DISTRIBUTED = "distributed",
  EXPIRED = "expired",
  DISCARDED = "discarded",
}

/**
 * Node Stock — one lot of an item held at one hub.
 *
 * Lot-level rather than a single quantity per item, because expiry is per lot
 * and expiry is what drives every real decision in food distribution: which
 * hub's stock moves, and which stock is about to be wasted.
 *
 * `item_key` is the shared identity that makes cross-hub matching possible. Two
 * hubs both holding carrots must agree on a key before anything can be
 * allocated between them; `item_label` is what a person reads.
 */
const NodeStock = model
  .define("node_stock", {
    id: model.id().primaryKey(),

    seller_id: model.text(),
    node_id: model.text(),

    /** Shared matching identity across hubs ("produce.carrots"). */
    item_key: model.text(),
    item_label: model.text().searchable(),
    unit_of_measure: model.text().default("each"),

    quantity: model.float().default(0),

    lot_code: model.text().nullable(),
    expires_at: model.dateTime().nullable(),

    /** Gates allocation: only a hub with cold storage may receive this. */
    requires_cold: model.boolean().default(false),

    source: model.enum(Object.values(StockSource)).default(StockSource.DONATED),
    status: model.enum(Object.values(StockStatus)).default(StockStatus.AVAILABLE),

    /** The intake that brought this lot in, when it was not purchased. */
    intake_receipt_id: model.text().nullable(),
    /** Link to the sellable side when the lot is also catalogued. */
    product_variant_id: model.text().nullable(),

    metadata: model.json().nullable(),
  })
  .indexes([
    { on: ["node_id"], name: "IDX_node_stock_node" },
    { on: ["seller_id"], name: "IDX_node_stock_seller" },
    { on: ["item_key"], name: "IDX_node_stock_item_key" },
    { on: ["status"], name: "IDX_node_stock_status" },
    { on: ["expires_at"], name: "IDX_node_stock_expires_at" },
  ])

export default NodeStock
