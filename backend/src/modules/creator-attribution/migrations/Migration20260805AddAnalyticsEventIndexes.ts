import { Migration } from "@mikro-orm/migrations"

/**
 * Phase 4A dashboards GROUP BY product_id and utm_campaign; the original
 * analytics_event indexes only cover event/creator/visitor/short-code.
 */
export class Migration20260805AddAnalyticsEventIndexes extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_analytics_event_product_time"
        ON "analytics_event" ("product_id", "occurred_at");
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_analytics_event_campaign_time"
        ON "analytics_event" ("utm_campaign", "occurred_at");
    `)
  }

  async down(): Promise<void> {
    this.addSql(`DROP INDEX IF EXISTS "IDX_analytics_event_product_time";`)
    this.addSql(`DROP INDEX IF EXISTS "IDX_analytics_event_campaign_time";`)
  }
}
