import { Migration } from "@mikro-orm/migrations"

/**
 * Adds Blackout commerce-catalog fields (§5) to `creator_listing`.
 *
 * CreatorListing is signed-bundle shaped and carried no price/category. The
 * Blackout `/v1/catalog/listings` contract needs priceCents, category,
 * currency, entitlementKind, availableSkus, mediaUrls, and tags. All nullable
 * so existing signed-bundle listings are untouched.
 */
export class Migration20260530AddBlackoutCatalogFields extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      ALTER TABLE "creator_listing"
        ADD COLUMN IF NOT EXISTS "category" TEXT NULL,
        ADD COLUMN IF NOT EXISTS "price_cents" INTEGER NULL,
        ADD COLUMN IF NOT EXISTS "currency" TEXT NULL,
        ADD COLUMN IF NOT EXISTS "entitlement_kind" TEXT NULL,
        ADD COLUMN IF NOT EXISTS "available_skus" JSONB NULL,
        ADD COLUMN IF NOT EXISTS "media_urls" JSONB NULL,
        ADD COLUMN IF NOT EXISTS "tags" JSONB NULL;
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_creator_listing_category"
        ON "creator_listing" ("category");
    `)
  }

  async down(): Promise<void> {
    this.addSql('DROP INDEX IF EXISTS "IDX_creator_listing_category";')
    this.addSql(`
      ALTER TABLE "creator_listing"
        DROP COLUMN IF EXISTS "category",
        DROP COLUMN IF EXISTS "price_cents",
        DROP COLUMN IF EXISTS "currency",
        DROP COLUMN IF EXISTS "entitlement_kind",
        DROP COLUMN IF EXISTS "available_skus",
        DROP COLUMN IF EXISTS "media_urls",
        DROP COLUMN IF EXISTS "tags";
    `)
  }
}
