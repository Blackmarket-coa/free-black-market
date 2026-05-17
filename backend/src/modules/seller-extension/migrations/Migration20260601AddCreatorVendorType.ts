import { Migration } from "@mikro-orm/migrations"

/**
 * Migration: Add `creator` to vendor_type_enum + creator-specific columns.
 *
 * Adds the `creator` value to the existing `vendor_type_enum` and creates
 * nullable creator-profile columns on `seller_metadata` used by the creator
 * monetization platform (creator_handle, creator_bio, creator_niches,
 * creator_total_followers, creator_audience_geo).
 *
 * `creator_handle` gets a partial unique index so multiple non-creator
 * sellers can leave it NULL but two creators cannot share the same handle.
 */
export class Migration20260601AddCreatorVendorType extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      DO $$ BEGIN
        ALTER TYPE "vendor_type_enum" ADD VALUE IF NOT EXISTS 'creator';
      EXCEPTION WHEN others THEN null; END $$;
    `)

    this.addSql(`
      ALTER TABLE "seller_metadata"
        ADD COLUMN IF NOT EXISTS "creator_handle" TEXT NULL,
        ADD COLUMN IF NOT EXISTS "creator_bio" TEXT NULL,
        ADD COLUMN IF NOT EXISTS "creator_niches" JSONB NULL,
        ADD COLUMN IF NOT EXISTS "creator_total_followers" INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "creator_audience_geo" JSONB NULL;
    `)

    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_seller_metadata_creator_handle"
        ON "seller_metadata" ("creator_handle")
        WHERE "creator_handle" IS NOT NULL AND "deleted_at" IS NULL;
    `)
  }

  async down(): Promise<void> {
    this.addSql('DROP INDEX IF EXISTS "UQ_seller_metadata_creator_handle";')
    this.addSql(`
      ALTER TABLE "seller_metadata"
        DROP COLUMN IF EXISTS "creator_audience_geo",
        DROP COLUMN IF EXISTS "creator_total_followers",
        DROP COLUMN IF EXISTS "creator_niches",
        DROP COLUMN IF EXISTS "creator_bio",
        DROP COLUMN IF EXISTS "creator_handle";
    `)
    // Note: Postgres has no clean way to remove a value from an enum without
    // recreating the type. We leave 'creator' in the enum on rollback.
  }
}
