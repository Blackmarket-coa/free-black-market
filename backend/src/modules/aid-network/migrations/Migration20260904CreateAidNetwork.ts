import { Migration } from "@mikro-orm/migrations"

/**
 * Aid Network: hubs, the stock each holds, non-purchase intake, and transfers
 * between hubs (opt-in).
 *
 * Stock is lot-level rather than one row per item per hub, because expiry is a
 * property of a lot and expiry drives every real decision here.
 */
export class Migration20260904CreateAidNetwork extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      DO $$ BEGIN
        CREATE TYPE "network_node_type_enum" AS ENUM ('pantry','free_store','kitchen','garden','warehouse','distribution_point','popup');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)
    this.addSql(`
      DO $$ BEGIN
        CREATE TYPE "network_node_status_enum" AS ENUM ('active','paused','closed');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)
    this.addSql(`
      DO $$ BEGIN
        CREATE TYPE "node_stock_source_enum" AS ENUM ('purchased','donated','rescued','gleaned','produced','transferred');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)
    this.addSql(`
      DO $$ BEGIN
        CREATE TYPE "node_stock_status_enum" AS ENUM ('available','reserved','distributed','expired','discarded');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)
    this.addSql(`
      DO $$ BEGIN
        CREATE TYPE "intake_source_enum" AS ENUM ('donation','rescue','gleaning','overproduction','transfer_in');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)
    this.addSql(`
      DO $$ BEGIN
        CREATE TYPE "intake_donor_type_enum" AS ENUM ('individual','business','farm','organization','anonymous');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)
    this.addSql(`
      DO $$ BEGIN
        CREATE TYPE "node_transfer_reason_enum" AS ENUM ('rebalance','surplus_redistribution','rescue','fulfillment','return');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)
    this.addSql(`
      DO $$ BEGIN
        CREATE TYPE "node_transfer_status_enum" AS ENUM ('requested','approved','in_transit','received','cancelled');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "network_node" (
        "id" TEXT NOT NULL,
        "seller_id" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "slug" TEXT NOT NULL,
        "node_type" network_node_type_enum NOT NULL DEFAULT 'pantry',
        "description" TEXT NULL,
        "address_line_1" TEXT NULL,
        "address_line_2" TEXT NULL,
        "city" TEXT NULL,
        "state" TEXT NULL,
        "postal_code" TEXT NULL,
        "country_code" TEXT NOT NULL DEFAULT 'US',
        "latitude" DOUBLE PRECISION NULL,
        "longitude" DOUBLE PRECISION NULL,
        "contact_name" TEXT NULL,
        "contact_email" TEXT NULL,
        "contact_phone" TEXT NULL,
        "has_cold_storage" BOOLEAN NOT NULL DEFAULT false,
        "accepts_intake" BOOLEAN NOT NULL DEFAULT true,
        "accepts_transfers" BOOLEAN NOT NULL DEFAULT true,
        "status" network_node_status_enum NOT NULL DEFAULT 'active',
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "network_node_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_network_node_seller" ON "network_node" ("seller_id") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_network_node_seller_slug" ON "network_node" ("seller_id", "slug") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_network_node_status" ON "network_node" ("status") WHERE "deleted_at" IS NULL;`)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "intake_receipt" (
        "id" TEXT NOT NULL,
        "seller_id" TEXT NOT NULL,
        "node_id" TEXT NOT NULL,
        "source" intake_source_enum NOT NULL DEFAULT 'donation',
        "donor_name" TEXT NULL,
        "donor_type" intake_donor_type_enum NOT NULL DEFAULT 'individual',
        "donor_contact" TEXT NULL,
        "received_at" TIMESTAMPTZ NOT NULL,
        "received_by" TEXT NULL,
        "estimated_value_cents" NUMERIC NULL,
        "raw_estimated_value_cents" JSONB NULL,
        "valuation_basis" TEXT NULL,
        "currency_code" TEXT NOT NULL DEFAULT 'usd',
        "acknowledgment_sent" BOOLEAN NOT NULL DEFAULT false,
        "fund_id" TEXT NULL,
        "notes" TEXT NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "intake_receipt_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_intake_receipt_node" ON "intake_receipt" ("node_id") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_intake_receipt_seller" ON "intake_receipt" ("seller_id") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_intake_receipt_source" ON "intake_receipt" ("source") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_intake_receipt_received_at" ON "intake_receipt" ("received_at") WHERE "deleted_at" IS NULL;`)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "node_stock" (
        "id" TEXT NOT NULL,
        "seller_id" TEXT NOT NULL,
        "node_id" TEXT NOT NULL,
        "item_key" TEXT NOT NULL,
        "item_label" TEXT NOT NULL,
        "unit_of_measure" TEXT NOT NULL DEFAULT 'each',
        "quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "lot_code" TEXT NULL,
        "expires_at" TIMESTAMPTZ NULL,
        "requires_cold" BOOLEAN NOT NULL DEFAULT false,
        "source" node_stock_source_enum NOT NULL DEFAULT 'donated',
        "status" node_stock_status_enum NOT NULL DEFAULT 'available',
        "intake_receipt_id" TEXT NULL,
        "product_variant_id" TEXT NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "node_stock_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_node_stock_node" ON "node_stock" ("node_id") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_node_stock_seller" ON "node_stock" ("seller_id") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_node_stock_item_key" ON "node_stock" ("item_key") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_node_stock_status" ON "node_stock" ("status") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_node_stock_expires_at" ON "node_stock" ("expires_at") WHERE "deleted_at" IS NULL;`)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "node_transfer" (
        "id" TEXT NOT NULL,
        "seller_id" TEXT NOT NULL,
        "from_node_id" TEXT NOT NULL,
        "to_node_id" TEXT NOT NULL,
        "item_key" TEXT NOT NULL,
        "item_label" TEXT NOT NULL,
        "unit_of_measure" TEXT NOT NULL DEFAULT 'each',
        "reason" node_transfer_reason_enum NOT NULL DEFAULT 'rebalance',
        "status" node_transfer_status_enum NOT NULL DEFAULT 'requested',
        "requested_qty" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "shipped_qty" DOUBLE PRECISION NULL,
        "received_qty" DOUBLE PRECISION NULL,
        "source_stock_id" TEXT NULL,
        "destination_stock_id" TEXT NULL,
        "requires_cold" BOOLEAN NOT NULL DEFAULT false,
        "temperature_logged" JSONB NULL,
        "courier_id" TEXT NULL,
        "expected_at" TIMESTAMPTZ NULL,
        "completed_at" TIMESTAMPTZ NULL,
        "notes" TEXT NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "node_transfer_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_node_transfer_from" ON "node_transfer" ("from_node_id") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_node_transfer_to" ON "node_transfer" ("to_node_id") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_node_transfer_seller" ON "node_transfer" ("seller_id") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_node_transfer_status" ON "node_transfer" ("status") WHERE "deleted_at" IS NULL;`)
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS "node_transfer";`)
    this.addSql(`DROP TABLE IF EXISTS "node_stock";`)
    this.addSql(`DROP TABLE IF EXISTS "intake_receipt";`)
    this.addSql(`DROP TABLE IF EXISTS "network_node";`)
    this.addSql(`DROP TYPE IF EXISTS "node_transfer_status_enum";`)
    this.addSql(`DROP TYPE IF EXISTS "node_transfer_reason_enum";`)
    this.addSql(`DROP TYPE IF EXISTS "intake_donor_type_enum";`)
    this.addSql(`DROP TYPE IF EXISTS "intake_source_enum";`)
    this.addSql(`DROP TYPE IF EXISTS "node_stock_status_enum";`)
    this.addSql(`DROP TYPE IF EXISTS "node_stock_source_enum";`)
    this.addSql(`DROP TYPE IF EXISTS "network_node_status_enum";`)
    this.addSql(`DROP TYPE IF EXISTS "network_node_type_enum";`)
  }
}
