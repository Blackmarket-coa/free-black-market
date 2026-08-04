import { Migration } from "@mikro-orm/migrations"

/**
 * Phase 9 — outbound channel connections and the FBM↔channel listing map.
 *
 * Two new tables, nothing altered. Enums are TEXT rather than PG enums, and
 * uniqueness is expressed with partial indexes predicated on
 * `deleted_at IS NULL`, matching every other module here: a soft-deleted
 * connection must not block a vendor reconnecting the same channel, which a
 * plain unique constraint would do.
 */
export class Migration20260812CreateChannelConnector extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "channel_connection" (
        "id" TEXT NOT NULL,
        "seller_id" TEXT NOT NULL,
        "channel_id" TEXT NOT NULL,
        "api_base_url" TEXT NOT NULL,
        "access_token" TEXT NOT NULL,
        "options" JSONB NULL,
        "enabled" BOOLEAN NOT NULL DEFAULT TRUE,
        "orders_synced_through" TIMESTAMPTZ NULL,
        "last_synced_at" TIMESTAMPTZ NULL,
        "last_sync_report" JSONB NULL,
        "last_error" TEXT NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "PK_channel_connection" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_channel_connection_seller"
        ON "channel_connection" ("seller_id") WHERE "deleted_at" IS NULL;
    `)
    // One live connection per seller per channel. Partial so a disconnected
    // vendor can reconnect the same channel later.
    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_channel_connection_seller_channel"
        ON "channel_connection" ("seller_id", "channel_id")
        WHERE "deleted_at" IS NULL;
    `)
    // The order-poll work list: enabled connections, oldest cursor first.
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_channel_connection_sync_due"
        ON "channel_connection" ("channel_id", "orders_synced_through")
        WHERE "enabled" = TRUE AND "deleted_at" IS NULL;
    `)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "channel_listing" (
        "id" TEXT NOT NULL,
        "seller_id" TEXT NOT NULL,
        "channel_id" TEXT NOT NULL,
        "product_id" TEXT NOT NULL,
        "external_id" TEXT NOT NULL,
        "sku" TEXT NULL,
        "last_pushed_at" TIMESTAMPTZ NULL,
        "last_error" TEXT NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "PK_channel_listing" PRIMARY KEY ("id")
      );
    `)
    // The row that stops duplicate listings: one mapping per product per
    // channel, so a re-push updates rather than creates.
    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_channel_listing_seller_channel_product"
        ON "channel_listing" ("seller_id", "channel_id", "product_id")
        WHERE "deleted_at" IS NULL;
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_channel_listing_external"
        ON "channel_listing" ("channel_id", "external_id")
        WHERE "deleted_at" IS NULL;
    `)
  }

  async down(): Promise<void> {
    this.addSql('DROP TABLE IF EXISTS "channel_listing" CASCADE;')
    this.addSql('DROP TABLE IF EXISTS "channel_connection" CASCADE;')
  }
}
