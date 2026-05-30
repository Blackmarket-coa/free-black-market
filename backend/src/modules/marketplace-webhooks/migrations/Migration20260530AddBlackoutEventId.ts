import { Migration } from "@mikro-orm/migrations"

/**
 * Adds the `event_id` column to webhook deliveries for the Blackout outbound
 * channel (§1). Blackout dedupes on (provider, eventId); we enforce a unique
 * partial index so a re-emit of the same logical event never enqueues a
 * second delivery. Per-seller deliveries leave it NULL.
 */
export class Migration20260530AddBlackoutEventId extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      ALTER TABLE "marketplace_webhook_delivery"
        ADD COLUMN IF NOT EXISTS "event_id" TEXT NULL;
    `)
    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_marketplace_webhook_delivery_event_id"
        ON "marketplace_webhook_delivery" ("event_id")
        WHERE "event_id" IS NOT NULL;
    `)
  }

  async down(): Promise<void> {
    this.addSql('DROP INDEX IF EXISTS "IDX_marketplace_webhook_delivery_event_id";')
    this.addSql('ALTER TABLE "marketplace_webhook_delivery" DROP COLUMN IF EXISTS "event_id";')
  }
}
