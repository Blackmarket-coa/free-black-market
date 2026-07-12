import { model } from "@medusajs/framework/utils"

/**
 * First-class order-level channel attribution (roadmap §1.7 / Phase 3A).
 * Where an order originated: the storefront, an in-person point of sale,
 * a vending surface, click-and-collect pickup, or an automated subscription
 * renewal. One row per order, written by the `attribute-channel-on-placed`
 * subscriber; clients declare a channel pre-completion via cart metadata
 * (`POST /store/carts/:id/channel`).
 */
export enum OrderChannel {
  ONLINE = "online",
  POS = "pos",
  VENDING = "vending",
  PICKUP = "pickup",
  SUBSCRIPTION = "subscription",
  OTHER = "other",
}

const OrderChannelAttribution = model
  .define("order_channel", {
    id: model.id().primaryKey(),

    order_id: model.text(),
    channel: model.enum(Object.values(OrderChannel)).default(OrderChannel.ONLINE),
    /** How the channel was determined: "stamp" | "subscription" | "default". */
    source: model.text().nullable(),
    /** Denormalized for the per-customer unified view. */
    customer_id: model.text().nullable(),

    metadata: model.json().nullable(),
  })
  .indexes([
    { on: ["order_id"], unique: true, name: "UQ_order_channel_order" },
    { on: ["customer_id"], name: "IDX_order_channel_customer" },
    { on: ["channel"], name: "IDX_order_channel_channel" },
  ])

export default OrderChannelAttribution
