import { Migration } from "@mikro-orm/migrations"

/**
 * Phase 10 — orders ingested from connected channels.
 *
 * One new table, nothing altered.
 *
 * The load-bearing constraint is the unique index on
 * `(channel_id, external_id)`: it is what makes a re-poll a no-op instead of a
 * second decrement against the same sale. Partial on `deleted_at IS NULL` like
 * every other index here, so a soft-deleted record does not permanently block
 * re-ingesting an order.
 */
export class Migration20260813CreateChannelOrder extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "channel_order" (
        "id" TEXT NOT NULL,
        "seller_id" TEXT NOT NULL,
        "channel_id" TEXT NOT NULL,
        "external_id" TEXT NOT NULL,
        "placed_at" TIMESTAMPTZ NOT NULL,
        "currency_code" TEXT NOT NULL,
        "total_amount" BIGINT NOT NULL DEFAULT 0,
        "channel_fee_amount" BIGINT NULL,
        "buyer_name" TEXT NULL,
        "buyer_email" TEXT NULL,
        "shipping_address" JSONB NULL,
        "items" JSONB NULL,
        "inventory_applied" BOOLEAN NOT NULL DEFAULT FALSE,
        "inventory_report" JSONB NULL,
        "fulfilled_at" TIMESTAMPTZ NULL,
        "tracking_number" TEXT NULL,
        "carrier" TEXT NULL,
        "fulfillment_reported_at" TIMESTAMPTZ NULL,
        "fulfillment_error" TEXT NULL,
        "raw" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "PK_channel_order" PRIMARY KEY ("id")
      );
    `)
    // What stops a re-poll double-decrementing the same sale.
    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_channel_order_channel_external"
        ON "channel_order" ("channel_id", "external_id")
        WHERE "deleted_at" IS NULL;
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_channel_order_seller"
        ON "channel_order" ("seller_id") WHERE "deleted_at" IS NULL;
    `)
    // The resume path: orders recorded but whose stock effect never landed.
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_channel_order_unapplied"
        ON "channel_order" ("seller_id", "channel_id")
        WHERE "inventory_applied" = FALSE AND "deleted_at" IS NULL;
    `)
    // The fulfilment-report work list: shipped locally, not yet accepted by
    // the channel. Amazon and Etsy penalise unreported shipments, so this
    // needs to be cheap to find.
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_channel_order_unreported_fulfillment"
        ON "channel_order" ("channel_id", "fulfilled_at")
        WHERE "fulfilled_at" IS NOT NULL
          AND "fulfillment_reported_at" IS NULL
          AND "deleted_at" IS NULL;
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_channel_order_placed_at"
        ON "channel_order" ("placed_at") WHERE "deleted_at" IS NULL;
    `)
    // Money is never negative here; a negative total is a mapping bug, not a
    // refund — refunds are their own record.
    this.addSql(`
      ALTER TABLE "channel_order"
        DROP CONSTRAINT IF EXISTS "CK_channel_order_amounts";
    `)
    this.addSql(`
      ALTER TABLE "channel_order"
        ADD CONSTRAINT "CK_channel_order_amounts"
        CHECK ("total_amount" >= 0
               AND ("channel_fee_amount" IS NULL OR "channel_fee_amount" >= 0));
    `)
  }

  async down(): Promise<void> {
    this.addSql('DROP TABLE IF EXISTS "channel_order" CASCADE;')
  }
}
