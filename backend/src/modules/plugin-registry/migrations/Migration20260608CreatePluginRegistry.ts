import { Migration } from "@mikro-orm/migrations"

/**
 * Migration: create `plugin_listing` backing the Black Market plugin
 * ecosystem (§16).
 */
export class Migration20260608CreatePluginRegistry extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "plugin_listing" (
        "id" TEXT NOT NULL,
        "slug" TEXT NOT NULL UNIQUE,
        "name" TEXT NOT NULL,
        "category" TEXT NOT NULL DEFAULT 'MARKETPLACE_EXTENSION',
        "description" TEXT NOT NULL,
        "author_seller_id" TEXT NULL,
        "manifest_url" TEXT NULL,
        "icon_url" TEXT NULL,
        "version" TEXT NOT NULL DEFAULT '1.0.0',
        "status" TEXT NOT NULL DEFAULT 'PUBLISHED',
        "install_count" INTEGER NOT NULL DEFAULT 0,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "plugin_listing_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_plugin_listing_slug" ON "plugin_listing" ("slug") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_plugin_listing_category" ON "plugin_listing" ("category") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_plugin_listing_status" ON "plugin_listing" ("status") WHERE "deleted_at" IS NULL;`)
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS "plugin_listing";`)
  }
}
