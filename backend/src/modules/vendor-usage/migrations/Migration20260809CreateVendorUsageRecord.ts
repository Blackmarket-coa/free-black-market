import { Migration } from "@mikro-orm/migrations"

/**
 * Create the metered-usage counter table.
 *
 * Additive; nothing existing is touched. This is the durable half of metering:
 * the rate limiter's counters live in Redis (or memory) with a one-minute
 * window and are deliberately ephemeral, which makes them useless for billing —
 * you cannot invoice for a number that evaporates every 60 seconds.
 *
 * `IDX_vendor_usage_record_period` (partial-unique) is the load-bearing index.
 * It is the conflict target for the atomic upsert that increments the counter,
 * so concurrent embed requests collapse onto one row instead of forking a
 * period into several partial counters that would each under-bill. `WHERE
 * deleted_at IS NULL` so a soft delete releases the period rather than
 * reserving it forever.
 *
 * `quantity` is BIGINT, not INTEGER: a busy vendor on the Scale plan is
 * budgeted five million requests a month, and INTEGER's ~2.1bn ceiling is only
 * about 400 such months away from a silent overflow on a single row.
 */
export class Migration20260809CreateVendorUsageRecord extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "vendor_usage_record" (
        "id" TEXT NOT NULL,
        "seller_id" TEXT NOT NULL,
        "metric" TEXT NOT NULL,
        "period_start" TIMESTAMPTZ NOT NULL,
        "period_end" TIMESTAMPTZ NOT NULL,
        "quantity" BIGINT NOT NULL DEFAULT 0,
        "billed_at" TIMESTAMPTZ NULL,
        "charge_id" TEXT NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "PK_vendor_usage_record" PRIMARY KEY ("id"),
        CONSTRAINT "CK_vendor_usage_record_quantity" CHECK ("quantity" >= 0),
        CONSTRAINT "CK_vendor_usage_record_period" CHECK ("period_end" > "period_start")
      );
    `)

    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_vendor_usage_record_period"
        ON "vendor_usage_record" ("seller_id", "metric", "period_start")
        WHERE "deleted_at" IS NULL;
    `)

    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_vendor_usage_record_billing"
        ON "vendor_usage_record" ("period_start", "billed_at")
        WHERE "deleted_at" IS NULL;
    `)
  }

  async down(): Promise<void> {
    this.addSql(`DROP INDEX IF EXISTS "IDX_vendor_usage_record_billing";`)
    this.addSql(`DROP INDEX IF EXISTS "IDX_vendor_usage_record_period";`)
    this.addSql(`DROP TABLE IF EXISTS "vendor_usage_record";`)
  }
}
