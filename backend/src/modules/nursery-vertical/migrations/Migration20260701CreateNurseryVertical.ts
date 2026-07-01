import { Migration } from "@mikro-orm/migrations"

/**
 * Nursery Vertical: per-product listing extensions (subtype, edible/medicinal
 * use, hardiness zone, propagation, channel fit, cost basis, plant-tag data).
 * Opt-in; core carries no nursery assumptions. Per-channel pricing reuses the
 * existing vendor_customer_tier mechanism (no new pricing table).
 */
export class Migration20260701CreateNurseryVertical extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      DO $$ BEGIN
        CREATE TYPE "nursery_listing_subtype_enum" AS ENUM (
          'live_plant_liner','live_plant_3_4in','live_plant_1gal','live_plant_3gal',
          'bare_root_dormant','cuttings_pads_bulk','divisions_pups_slips_bulk',
          'seed_packet','dried_value_added_by_weight'
        );
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "nursery_product_attribute" (
        "id" TEXT NOT NULL,
        "product_id" TEXT NOT NULL,
        "subtype" nursery_listing_subtype_enum NOT NULL,
        "edible_use" JSONB NULL,
        "medicinal_use" JSONB NULL,
        "hardiness_zone" TEXT NULL,
        "propagation_method" TEXT NULL,
        "channel_fit" JSONB NULL,
        "cost_to_produce" DOUBLE PRECISION NULL,
        "tag_data" JSONB NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "nursery_product_attribute_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_nursery_product_attribute_product_id" ON "nursery_product_attribute" ("product_id") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_nursery_product_attribute_subtype" ON "nursery_product_attribute" ("subtype") WHERE "deleted_at" IS NULL;`)
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS "nursery_product_attribute";`)
    this.addSql(`DROP TYPE IF EXISTS "nursery_listing_subtype_enum";`)
  }
}
