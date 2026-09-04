import { model } from "@medusajs/framework/utils"

/** What kind of place this hub is. Drives nothing mechanically; labels the map. */
export enum NodeType {
  PANTRY = "pantry",
  FREE_STORE = "free_store",
  KITCHEN = "kitchen",
  GARDEN = "garden",
  WAREHOUSE = "warehouse",
  DISTRIBUTION_POINT = "distribution_point",
  POPUP = "popup",
}

export enum NodeStatus {
  ACTIVE = "active",
  PAUSED = "paused",
  CLOSED = "closed",
}

/**
 * Network Node — one physical hub in a distribution network.
 *
 * The thing the stack had no word for. `food_producer` is an organisation with
 * an address; `seller` is a vendor. Neither is a *place that holds stock the
 * network can move between*, which is what a pantry, free store or distribution
 * point actually is, and without it there is nothing for cross-hub allocation
 * to allocate between.
 *
 * `has_cold_storage` matches the flag `food-distribution` already puts on a
 * courier, so a cold item can be traced end to end: held cold at the origin,
 * carried cold, held cold at the destination.
 */
const NetworkNode = model
  .define("network_node", {
    id: model.id().primaryKey(),

    seller_id: model.text(),

    name: model.text().searchable(),
    /** Short operator-chosen handle, unique per seller. */
    slug: model.text(),
    node_type: model.enum(Object.values(NodeType)).default(NodeType.PANTRY),
    description: model.text().nullable(),

    address_line_1: model.text().nullable(),
    address_line_2: model.text().nullable(),
    city: model.text().nullable(),
    state: model.text().nullable(),
    postal_code: model.text().nullable(),
    country_code: model.text().default("US"),
    latitude: model.float().nullable(),
    longitude: model.float().nullable(),

    contact_name: model.text().nullable(),
    contact_email: model.text().nullable(),
    contact_phone: model.text().nullable(),

    /** Whether this hub can hold cold items — gates cold-chain allocation. */
    has_cold_storage: model.boolean().default(false),
    /** Whether the hub receives donated/rescued goods. */
    accepts_intake: model.boolean().default(true),
    /** Whether the hub participates in cross-hub transfers. */
    accepts_transfers: model.boolean().default(true),

    status: model.enum(Object.values(NodeStatus)).default(NodeStatus.ACTIVE),

    metadata: model.json().nullable(),
  })
  .indexes([
    { on: ["seller_id"], name: "IDX_network_node_seller" },
    { on: ["seller_id", "slug"], name: "UQ_network_node_seller_slug", unique: true },
    { on: ["status"], name: "IDX_network_node_status" },
  ])

export default NetworkNode
