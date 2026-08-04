import { model } from "@medusajs/framework/utils"

/**
 * One vendor's connection to one outbound sales channel.
 *
 * Follows the `woocommerce_connection` / `odoo_connection` pattern already in
 * the codebase: per-seller row, credentials on the row, a sync cursor and a
 * last-run report.
 *
 * **On credential storage:** the token is encrypted at rest by
 * `lib/credentials.ts`, applied in the service so no caller can forget. An
 * earlier version of this comment justified a plaintext column by saying the
 * other connection tables kept plaintext too; that was simply wrong —
 * `woocommerce_connection` and `odoo_connection` both encrypt at the write path
 * — which left this the one table holding a live marketplace token in the
 * clear. Rows written before the change read through unchanged and are
 * upgraded on their next write.
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

    /**
     * No request may be sent to this connection before this instant.
     *
     * Phase 12. The reason a backoff is stored rather than held in memory: the
     * sync jobs are cron-driven and stateless, so an in-process delay dies with
     * the run that set it and the next tick starts hammering again. Persisting
     * it is also what lets a backoff be *longer* than the schedule — and a
     * backoff shorter than the schedule is not a backoff, it is a no-op.
     */
    throttled_until: model.dateTime().nullable(),

    /**
     * Failures since the last success. Drives the exponential step, and resets
     * to zero on any successful call so one bad afternoon does not permanently
     * slow a healthy connection.
     */
    consecutive_failures: model.number().default(0),

    /**
     * The channel rejected the credentials. Distinct from `enabled`, which is
     * the vendor's own choice: this one is not a preference, it is a fact about
     * a token that no retry will fix, and the panel needs to say "reconnect"
     * rather than "we are retrying".
     */
    needs_reauth: model.boolean().default(false),

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
