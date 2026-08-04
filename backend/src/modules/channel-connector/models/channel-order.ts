import { model } from "@medusajs/framework/utils"

/**
 * An order a channel captured on a vendor's behalf.
 *
 * Stored rather than converted straight into a Medusa order: a channel order
 * has already been paid for and fulfilled-by-agreement elsewhere, so forcing it
 * through FBM's checkout would invent a payment that never happened. What FBM
 * needs from it is the stock effect and the revenue record, and this row is
 * both.
 *
 * `channel_fee_amount` is captured at ingestion rather than reconstructed
 * later. Faire, Etsy and Amazon all take their cut before money reaches the
 * vendor, so an order recorded at gross overstates what they earned — the
 * reconciliation gap Phase 11 exists to close, and it is free to capture now
 * and expensive to recover afterwards.
 */
const ChannelOrderRecord = model
  .define("channel_order", {
    id: model.id().primaryKey(),

    seller_id: model.text(),
    channel_id: model.text(),
    /** The channel's own id. The idempotency key for ingestion. */
    external_id: model.text(),

    placed_at: model.dateTime(),
    currency_code: model.text(),
    /** Minor units, gross of the channel's cut. */
    total_amount: model.number().default(0),
    /** The channel's own cut in minor units, when it reports one. */
    channel_fee_amount: model.number().nullable(),

    buyer_name: model.text().nullable(),
    buyer_email: model.text().nullable(),
    shipping_address: model.json().nullable(),
    items: model.json().nullable(),

    /**
     * Whether this order's stock effect has been applied.
     *
     * The flag that makes ingestion exactly-once across a crash. Recording and
     * decrementing cannot be one atomic act, and getting the order wrong costs
     * either a phantom stockout or an oversell — see `decideIngestion` for why
     * neither ordering is safe without this.
     */
    inventory_applied: model.boolean().default(false),
    /** What the decrement actually did, including anything it could not match. */
    inventory_report: model.json().nullable(),

    /** Reported back to the channel; several penalise not doing so. */
    fulfilled_at: model.dateTime().nullable(),
    tracking_number: model.text().nullable(),

    raw: model.json().nullable(),
  })
  .indexes([
    { on: ["seller_id"], name: "IDX_channel_order_seller" },
    {
      on: ["channel_id", "external_id"],
      unique: true,
      name: "UQ_channel_order_channel_external",
    },
    { on: ["placed_at"], name: "IDX_channel_order_placed_at" },
  ])

export default ChannelOrderRecord
