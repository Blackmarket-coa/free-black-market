import { model } from "@medusajs/framework/utils"

/**
 * One vendor's connection to one outbound sales channel.
 *
 * Follows the `woocommerce_connection` / `odoo_connection` pattern already in
 * the codebase: per-seller row, credentials on the row, a sync cursor and a
 * last-run report.
 *
 * **On credential storage:** the token is held in a plain column, matching the
 * existing connection tables rather than diverging from them. That is a
 * deliberate consistency choice for this PR, not an endorsement — encrypting
 * third-party credentials at rest is worth doing, and doing it for one table
 * while `woocommerce_connection` and `odoo_connection` keep plaintext would
 * give the appearance of protection without the substance. It belongs in a
 * change that covers all three.
 */
const ChannelConnection = model
  .define("channel_connection", {
    id: model.id().primaryKey(),

    seller_id: model.text(),
    /** A `ChannelId` from `catalog.ts`. */
    channel_id: model.text(),

    /** Overridable so a sandbox can be targeted without a code change. */
    api_base_url: model.text(),
    access_token: model.text(),
    /** Channel-specific extras — a shop id, a region. */
    options: model.json().nullable(),

    /**
     * Whether syncing is running. Separate from deleting the connection so a
     * vendor can stop pushing without losing their credentials and their
     * external-id map, which is what makes resuming safe rather than a
     * catalogue full of duplicates.
     */
    enabled: model.boolean().default(true),

    /**
     * How far order ingestion has read, as a channel timestamp.
     *
     * Stored here rather than in the adapter so a redeploy or a second worker
     * cannot lose the cursor — losing it re-imports a vendor's order history,
     * and the idempotency key is the only thing standing between that and
     * duplicated revenue figures.
     */
    orders_synced_through: model.dateTime().nullable(),

    last_synced_at: model.dateTime().nullable(),
    last_sync_report: model.json().nullable(),
    /** Last failure, kept so the panel can explain a stalled connection. */
    last_error: model.text().nullable(),

    metadata: model.json().nullable(),
  })
  .indexes([
    { on: ["seller_id"], name: "IDX_channel_connection_seller" },
    {
      on: ["seller_id", "channel_id"],
      unique: true,
      name: "UQ_channel_connection_seller_channel",
    },
  ])

export default ChannelConnection
