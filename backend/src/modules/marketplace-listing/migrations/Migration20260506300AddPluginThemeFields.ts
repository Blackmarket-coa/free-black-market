import { Migration } from "@mikro-orm/migrations"

/**
 * Add BMC marketplace-category fields to creator_listing so plugin /
 * theme / emoji-pack / access-pass listings can be queried and surfaced
 * uniformly. All columns are nullable; existing listings are unaffected.
 */
export class Migration20260506300AddPluginThemeFields extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      ALTER TABLE "creator_listing"
        ADD COLUMN IF NOT EXISTS "plugin_slug" TEXT NULL,
        ADD COLUMN IF NOT EXISTS "plugin_version" TEXT NULL,
        ADD COLUMN IF NOT EXISTS "plugin_repo_url" TEXT NULL,
        ADD COLUMN IF NOT EXISTS "theme_slug" TEXT NULL,
        ADD COLUMN IF NOT EXISTS "emoji_pack_slug" TEXT NULL,
        ADD COLUMN IF NOT EXISTS "compatible_with" JSONB NULL,
        ADD COLUMN IF NOT EXISTS "developer_seller_id" TEXT NULL;
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_creator_listing_plugin_slug" ON "creator_listing" ("plugin_slug") WHERE "plugin_slug" IS NOT NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_creator_listing_theme_slug" ON "creator_listing" ("theme_slug") WHERE "theme_slug" IS NOT NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_creator_listing_developer" ON "creator_listing" ("developer_seller_id") WHERE "developer_seller_id" IS NOT NULL;`)
  }

  async down(): Promise<void> {
    this.addSql(`DROP INDEX IF EXISTS "IDX_creator_listing_plugin_slug";`)
    this.addSql(`DROP INDEX IF EXISTS "IDX_creator_listing_theme_slug";`)
    this.addSql(`DROP INDEX IF EXISTS "IDX_creator_listing_developer";`)
    this.addSql(`
      ALTER TABLE "creator_listing"
        DROP COLUMN IF EXISTS "plugin_slug",
        DROP COLUMN IF EXISTS "plugin_version",
        DROP COLUMN IF EXISTS "plugin_repo_url",
        DROP COLUMN IF EXISTS "theme_slug",
        DROP COLUMN IF EXISTS "emoji_pack_slug",
        DROP COLUMN IF EXISTS "compatible_with",
        DROP COLUMN IF EXISTS "developer_seller_id";
    `)
  }
}
