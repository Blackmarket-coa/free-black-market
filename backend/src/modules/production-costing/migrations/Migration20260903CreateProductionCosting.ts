import { Migration } from "@mikro-orm/migrations"

/**
 * Production Costing: COGS lines against production batches (opt-in).
 *
 * Carries the money the production ledger deliberately does not, including the
 * cash/in-kind split that lets a mutual-aid producer see both what a batch cost
 * to make and how much cash it took.
 */
export class Migration20260903CreateProductionCosting extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      DO $$ BEGIN
        CREATE TYPE "production_cost_category_enum" AS ENUM ('material','labor','packaging','freight_in','overhead');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)
    this.addSql(`
      DO $$ BEGIN
        CREATE TYPE "production_cost_source_enum" AS ENUM ('purchased','donated','foraged','own','swap');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "production_cost_entry" (
        "id" TEXT NOT NULL,
        "seller_id" TEXT NOT NULL,
        "production_batch_id" TEXT NOT NULL,
        "category" production_cost_category_enum NOT NULL,
        "source" production_cost_source_enum NOT NULL DEFAULT 'purchased',
        "label" TEXT NOT NULL,
        "quantity" NUMERIC NOT NULL DEFAULT 1,
        "unit_amount_cents" NUMERIC NOT NULL DEFAULT 0,
        "raw_unit_amount_cents" JSONB NOT NULL DEFAULT '{"value":"0","precision":20}',
        "amount_cents" NUMERIC NOT NULL,
        "raw_amount_cents" JSONB NOT NULL DEFAULT '{"value":"0","precision":20}',
        "currency_code" TEXT NOT NULL DEFAULT 'usd',
        "is_cash_outlay" BOOLEAN NOT NULL DEFAULT true,
        "incurred_at" TIMESTAMPTZ NULL,
        "reference_type" TEXT NULL,
        "reference_id" TEXT NULL,
        "notes" TEXT NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "production_cost_entry_pkey" PRIMARY KEY ("id")
      );
    `)

    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_production_cost_entry_batch" ON "production_cost_entry" ("production_batch_id") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_production_cost_entry_seller" ON "production_cost_entry" ("seller_id") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_production_cost_entry_category" ON "production_cost_entry" ("category") WHERE "deleted_at" IS NULL;`)
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS "production_cost_entry";`)
    this.addSql(`DROP TYPE IF EXISTS "production_cost_source_enum";`)
    this.addSql(`DROP TYPE IF EXISTS "production_cost_category_enum";`)
  }
}
