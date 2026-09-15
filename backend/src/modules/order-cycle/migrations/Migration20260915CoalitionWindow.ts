import { Migration } from "@mikro-orm/migrations"

/**
 * Let an order cycle record the Blackout coalition and campaign that opened it.
 *
 * The campaign index is UNIQUE (partial, over live rows) so a retried
 * "open the shared window" call cannot produce two cycles for one campaign —
 * the route is idempotent, and the database backs that rather than trusting it.
 */
export class Migration20260915CoalitionWindow extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      ALTER TABLE "order_cycle"
      ADD COLUMN IF NOT EXISTS "blackout_coalition_id" TEXT NULL,
      ADD COLUMN IF NOT EXISTS "blackout_campaign_id" TEXT NULL;
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_ORDER_CYCLE_COALITION"
      ON "order_cycle" ("blackout_coalition_id")
      WHERE "deleted_at" IS NULL;
    `)
    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_ORDER_CYCLE_CAMPAIGN"
      ON "order_cycle" ("blackout_campaign_id")
      WHERE "deleted_at" IS NULL AND "blackout_campaign_id" IS NOT NULL;
    `)
  }

  async down(): Promise<void> {
    this.addSql(`DROP INDEX IF EXISTS "IDX_ORDER_CYCLE_CAMPAIGN";`)
    this.addSql(`DROP INDEX IF EXISTS "IDX_ORDER_CYCLE_COALITION";`)
    this.addSql(`
      ALTER TABLE "order_cycle"
      DROP COLUMN IF EXISTS "blackout_campaign_id",
      DROP COLUMN IF EXISTS "blackout_coalition_id";
    `)
  }
}
