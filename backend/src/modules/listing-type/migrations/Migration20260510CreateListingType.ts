import { Migration } from "@mikro-orm/migrations"

/**
 * Migration: create `listing_type` table.
 *
 * Backed by the in-code catalog at
 * `backend/src/modules/listing-type/catalog/index.ts`.
 *
 * See `docs/LISTING_TYPES.md`.
 */
export class Migration20260510CreateListingType extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "listing_type" (
        "id" TEXT NOT NULL,
        "catalog_id" TEXT NOT NULL UNIQUE,
        "display_name" TEXT NOT NULL,
        "description" TEXT NOT NULL,
        "requires_shipping" BOOLEAN NOT NULL DEFAULT false,
        "requires_capacity" BOOLEAN NOT NULL DEFAULT false,
        "requires_recurrence" BOOLEAN NOT NULL DEFAULT false,
        "requires_escrow" BOOLEAN NOT NULL DEFAULT false,
        "unique_inventory" BOOLEAN NOT NULL DEFAULT false,
        "is_active" BOOLEAN NOT NULL DEFAULT true,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "listing_type_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_listing_type_catalog_id" ON "listing_type" ("catalog_id") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_listing_type_is_active" ON "listing_type" ("is_active") WHERE "deleted_at" IS NULL;`)
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS "listing_type";`)
  }
}
