import { Migration } from "@mikro-orm/migrations"

export class Migration20260801CreateOrderSubcontract extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      DO $$ BEGIN
        CREATE TYPE "order_subcontract_status_enum" AS ENUM (
          'proposed', 'accepted', 'in_progress', 'delivered',
          'accepted_by_parent', 'disputed', 'canceled'
        );
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)
    this.addSql(`
      DO $$ BEGIN
        CREATE TYPE "subcontract_event_type_enum" AS ENUM (
          'proposed', 'accepted', 'materials_received', 'production_started',
          'qc_passed', 'shipped', 'delivered', 'accepted_by_parent',
          'damaged', 'rework_requested', 'disputed', 'resolved', 'canceled'
        );
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "order_subcontract" (
        "id" TEXT NOT NULL,
        "parent_order_id" TEXT NOT NULL,
        "parent_seller_id" TEXT NOT NULL,
        "subcontract_seller_id" TEXT NOT NULL,
        "contract_id" TEXT NOT NULL,
        "program_id" TEXT NULL,
        "order_item_ids" JSONB NOT NULL,
        "unit_count" INTEGER NOT NULL,
        "unit_price_cents" INTEGER NOT NULL,
        "currency_code" TEXT NOT NULL DEFAULT 'usd',
        "total_cents" NUMERIC NOT NULL,
        "status" order_subcontract_status_enum NOT NULL DEFAULT 'proposed',
        "pickup_at" TIMESTAMPTZ NULL,
        "deliver_to" JSONB NULL,
        "escrow_ledger_entry_id" TEXT NULL,
        "release_ledger_entry_id" TEXT NULL,
        "dispute_reason" TEXT NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "order_subcontract_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_subcontract_parent_order" ON "order_subcontract" ("parent_order_id");`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_subcontract_seller_status" ON "order_subcontract" ("subcontract_seller_id", "status");`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_subcontract_parent_seller_status" ON "order_subcontract" ("parent_seller_id", "status");`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_subcontract_contract" ON "order_subcontract" ("contract_id");`)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "subcontract_event" (
        "id" TEXT NOT NULL,
        "subcontract_id" TEXT NOT NULL,
        "event_type" subcontract_event_type_enum NOT NULL,
        "actor_seller_id" TEXT NULL,
        "proof_id" TEXT NULL,
        "note" TEXT NULL,
        "occurred_at" TIMESTAMPTZ NOT NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "subcontract_event_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_subcontract_event_subcontract_time" ON "subcontract_event" ("subcontract_id", "occurred_at");`)
  }

  async down(): Promise<void> {
    this.addSql('DROP TABLE IF EXISTS "subcontract_event" CASCADE;')
    this.addSql('DROP TABLE IF EXISTS "order_subcontract" CASCADE;')
    this.addSql('DROP TYPE IF EXISTS "subcontract_event_type_enum" CASCADE;')
    this.addSql('DROP TYPE IF EXISTS "order_subcontract_status_enum" CASCADE;')
  }
}
