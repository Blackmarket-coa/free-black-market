import { Migration } from "@mikro-orm/migrations"

/**
 * Phase 1 / Slice B — analytics_event ingest table.
 *
 * Captures the canonical storefront/backend funnel events:
 * page_view, product_view, add_to_cart, purchase, share, click_affiliate,
 * signup, subscribe, creator_profile_view, creator_link_clicked, etc.
 * Indexes optimize for the dashboard query patterns Phase 4 will need.
 */
export class Migration20260520205AddAnalyticsEvents extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "analytics_event" (
        "id" TEXT NOT NULL,
        "event_name" TEXT NOT NULL,
        "visitor_token" TEXT NULL,
        "customer_id" TEXT NULL,
        "creator_seller_id" TEXT NULL,
        "affiliate_short_code" TEXT NULL,
        "affiliate_link_id" TEXT NULL,
        "order_id" TEXT NULL,
        "product_id" TEXT NULL,
        "variant_id" TEXT NULL,
        "utm_source" TEXT NULL,
        "utm_medium" TEXT NULL,
        "utm_campaign" TEXT NULL,
        "utm_content" TEXT NULL,
        "path" TEXT NULL,
        "referrer" TEXT NULL,
        "device_type" TEXT NULL,
        "country" TEXT NULL,
        "payload" JSONB NULL,
        "occurred_at" TIMESTAMPTZ NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "analytics_event_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(
      'CREATE INDEX IF NOT EXISTS "IDX_analytics_event_name_time" ON "analytics_event" ("event_name", "occurred_at");'
    )
    this.addSql(
      'CREATE INDEX IF NOT EXISTS "IDX_analytics_event_creator_time" ON "analytics_event" ("creator_seller_id", "occurred_at");'
    )
    this.addSql(
      'CREATE INDEX IF NOT EXISTS "IDX_analytics_event_visitor_time" ON "analytics_event" ("visitor_token", "occurred_at");'
    )
    this.addSql(
      'CREATE INDEX IF NOT EXISTS "IDX_analytics_event_short_code_time" ON "analytics_event" ("affiliate_short_code", "occurred_at");'
    )
  }

  async down(): Promise<void> {
    this.addSql('DROP TABLE IF EXISTS "analytics_event" CASCADE;')
  }
}
