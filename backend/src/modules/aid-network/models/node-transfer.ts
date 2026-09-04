import { model } from "@medusajs/framework/utils"

/** Why stock is moving. Distinguishes rescue routing from ordinary rebalancing. */
export enum TransferReason {
  /** Levelling stock across hubs. */
  REBALANCE = "rebalance",
  /** Moving surplus before it spoils. */
  SURPLUS_REDISTRIBUTION = "surplus_redistribution",
  /** Recovered goods routed to where they are needed. */
  RESCUE = "rescue",
  /** Moving stock to satisfy a specific request. */
  FULFILLMENT = "fulfillment",
  /** Sending stock back where it came from. */
  RETURN = "return",
}

export enum TransferStatus {
  REQUESTED = "requested",
  APPROVED = "approved",
  IN_TRANSIT = "in_transit",
  RECEIVED = "received",
  CANCELLED = "cancelled",
}

/**
 * Node Transfer — stock moving from one hub to another.
 *
 * Quantities are recorded at three points (`requested`, `shipped`, `received`)
 * rather than one, because in this domain they genuinely differ: a pallet is
 * requested, part of it is loaded, and some of it arrives spoiled. Collapsing
 * them to a single number destroys the shrinkage signal that tells a network
 * which route is losing food.
 *
 * `temperature_logged` mirrors the shape `food-distribution` already uses on a
 * delivery, so a cold item's chain of custody reads the same whether it moved
 * to a household or between two hubs.
 */
const NodeTransfer = model
  .define("node_transfer", {
    id: model.id().primaryKey(),

    seller_id: model.text(),

    from_node_id: model.text(),
    to_node_id: model.text(),

    item_key: model.text(),
    item_label: model.text(),
    unit_of_measure: model.text().default("each"),

    reason: model.enum(Object.values(TransferReason)).default(TransferReason.REBALANCE),
    status: model.enum(Object.values(TransferStatus)).default(TransferStatus.REQUESTED),

    requested_qty: model.float().default(0),
    shipped_qty: model.float().nullable(),
    received_qty: model.float().nullable(),

    /** The lot being drawn down, when the transfer came from a specific lot. */
    source_stock_id: model.text().nullable(),
    /** The lot created at the destination once the transfer is received. */
    destination_stock_id: model.text().nullable(),

    requires_cold: model.boolean().default(false),
    /** [{ temp, timestamp }] — same shape as food-distribution's delivery log. */
    temperature_logged: model.json().nullable(),
    /** Optional link to a food-distribution courier carrying the transfer. */
    courier_id: model.text().nullable(),

    expected_at: model.dateTime().nullable(),
    completed_at: model.dateTime().nullable(),

    notes: model.text().nullable(),
    metadata: model.json().nullable(),
  })
  .indexes([
    { on: ["from_node_id"], name: "IDX_node_transfer_from" },
    { on: ["to_node_id"], name: "IDX_node_transfer_to" },
    { on: ["seller_id"], name: "IDX_node_transfer_seller" },
    { on: ["status"], name: "IDX_node_transfer_status" },
  ])

export default NodeTransfer
