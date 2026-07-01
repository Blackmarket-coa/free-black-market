import { Migration } from "@mikro-orm/migrations"

/**
 * Production Ledger: generic "what was made/grown" batch records (opt-in). Links
 * to sellable variants/harvest batches so produced-vs-sold reconstructs from
 * real orders. Vertical specifics live in the `attributes` JSON column.
 */
export class Migration20260701CreateProductionLedger extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      DO $$ BEGIN
        CREATE TYPE "production_source_enum" AS ENUM ('own','foraged','swap','purchased');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)
    this.addSql(`
      DO $$ BEGIN
        CREATE TYPE "production_batch_status_enum" AS ENUM ('started','growing','ready','sold_out','lost');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "production_batch" (
        "id" TEXT NOT NULL,
        "seller_id" TEXT NOT NULL,
        "item_label" TEXT NOT NULL,
        "method" TEXT NULL,
        "start_date" TIMESTAMPTZ NULL,
        "qty_started" INTEGER NOT NULL DEFAULT 0,
        "source" production_source_enum NOT NULL DEFAULT 'own',
        "controlled_environment" BOOLEAN NOT NULL DEFAULT false,
        "yield_qty" INTEGER NULL,
        "status" production_batch_status_enum NOT NULL DEFAULT 'started',
        "product_variant_id" TEXT NULL,
        "harvest_batch_id" TEXT NULL,
        "attributes" JSONB NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "production_batch_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_production_batch_seller_id" ON "production_batch" ("seller_id") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_production_batch_variant_id" ON "production_batch" ("product_variant_id") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_production_batch_status" ON "production_batch" ("status") WHERE "deleted_at" IS NULL;`)
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS "production_batch";`)
    this.addSql(`DROP TYPE IF EXISTS "production_batch_status_enum";`)
    this.addSql(`DROP TYPE IF EXISTS "production_source_enum";`)
  }
}
