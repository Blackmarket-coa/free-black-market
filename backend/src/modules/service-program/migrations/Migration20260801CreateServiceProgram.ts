import { Migration } from "@mikro-orm/migrations"

export class Migration20260801CreateServiceProgram extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      DO $$ BEGIN
        CREATE TYPE "service_category_enum" AS ENUM (
          'apparel_press', 'packaging', 'photography', 'design',
          'fulfillment', 'courier', 'repair', 'fabrication',
          'co_packing', 'assembly', 'custom'
        );
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)
    this.addSql(`
      DO $$ BEGIN
        CREATE TYPE "service_program_type_enum" AS ENUM (
          'bounty_open', 'bounty_invite', 'fixed_contract',
          'throughput_pool', 'order_subcontract'
        );
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)
    this.addSql(`
      DO $$ BEGIN
        CREATE TYPE "service_program_status_enum" AS ENUM (
          'draft', 'active', 'paused', 'closed', 'archived'
        );
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)
    this.addSql(`
      DO $$ BEGIN
        CREATE TYPE "service_pricing_model_enum" AS ENUM (
          'per_unit', 'per_hour', 'flat', 'tiered'
        );
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)
    this.addSql(`
      DO $$ BEGIN
        CREATE TYPE "service_application_status_enum" AS ENUM (
          'pending', 'approved', 'rejected', 'withdrawn'
        );
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)
    this.addSql(`
      DO $$ BEGIN
        CREATE TYPE "service_contract_status_enum" AS ENUM (
          'active', 'in_progress', 'delivered', 'accepted',
          'disputed', 'canceled'
        );
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "service_program" (
        "id" TEXT NOT NULL,
        "vendor_id" TEXT NOT NULL,
        "title" TEXT NOT NULL,
        "slug" TEXT NOT NULL,
        "description" TEXT NULL,
        "deliverable_spec" JSONB NULL,
        "acceptance_criteria" JSONB NULL,
        "service_category" service_category_enum NOT NULL,
        "program_type" service_program_type_enum NOT NULL,
        "pricing_model" service_pricing_model_enum NOT NULL,
        "status" service_program_status_enum NOT NULL DEFAULT 'draft',
        "unit_price_cents" INTEGER NULL,
        "hourly_rate_cents" INTEGER NULL,
        "flat_price_cents" INTEGER NULL,
        "pool_total_cents" INTEGER NULL,
        "currency_code" TEXT NOT NULL DEFAULT 'usd',
        "min_units" INTEGER NULL,
        "max_units" INTEGER NULL,
        "units_committed" INTEGER NOT NULL DEFAULT 0,
        "deadline_at" TIMESTAMPTZ NULL,
        "starts_at" TIMESTAMPTZ NULL,
        "ends_at" TIMESTAMPTZ NULL,
        "budget_cap_cents" INTEGER NULL,
        "escrow_amount_cents" INTEGER NOT NULL DEFAULT 0,
        "requires_kyc" BOOLEAN NOT NULL DEFAULT FALSE,
        "min_verification_level" TEXT NULL,
        "geo_allowlist" JSONB NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "service_program_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_service_program_vendor" ON "service_program" ("vendor_id");`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_service_program_category" ON "service_program" ("service_category");`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_service_program_status" ON "service_program" ("status");`)
    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_service_program_vendor_slug"
        ON "service_program" ("vendor_id", "slug")
        WHERE "deleted_at" IS NULL;
    `)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "service_application" (
        "id" TEXT NOT NULL,
        "program_id" TEXT NOT NULL,
        "service_seller_id" TEXT NOT NULL,
        "proposed_unit_price_cents" INTEGER NULL,
        "proposed_capacity" INTEGER NULL,
        "proposed_lead_time_days" INTEGER NULL,
        "sample_portfolio_urls" JSONB NULL,
        "pitch" TEXT NULL,
        "status" service_application_status_enum NOT NULL DEFAULT 'pending',
        "decided_at" TIMESTAMPTZ NULL,
        "decided_by" TEXT NULL,
        "decision_reason" TEXT NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "service_application_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_service_application_program" ON "service_application" ("program_id");`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_service_application_service_seller" ON "service_application" ("service_seller_id");`)
    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_service_application"
        ON "service_application" ("program_id", "service_seller_id")
        WHERE "deleted_at" IS NULL;
    `)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "service_contract" (
        "id" TEXT NOT NULL,
        "program_id" TEXT NOT NULL,
        "application_id" TEXT NOT NULL,
        "service_seller_id" TEXT NOT NULL,
        "vendor_id" TEXT NOT NULL,
        "status" service_contract_status_enum NOT NULL DEFAULT 'active',
        "effective_from" TIMESTAMPTZ NOT NULL,
        "effective_until" TIMESTAMPTZ NULL,
        "terms_snapshot" JSONB NOT NULL,
        "milestones" JSONB NULL,
        "escrow_ledger_entry_id" TEXT NULL,
        "escrow_amount_cents" INTEGER NOT NULL DEFAULT 0,
        "total_units_delivered" INTEGER NOT NULL DEFAULT 0,
        "total_paid_cents" NUMERIC NOT NULL DEFAULT 0,
        "dispute_reason" TEXT NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "service_contract_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_service_contract_seller_status" ON "service_contract" ("service_seller_id", "status");`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_service_contract_vendor_status" ON "service_contract" ("vendor_id", "status");`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_service_contract_program" ON "service_contract" ("program_id");`)
  }

  async down(): Promise<void> {
    this.addSql('DROP TABLE IF EXISTS "service_contract" CASCADE;')
    this.addSql('DROP TABLE IF EXISTS "service_application" CASCADE;')
    this.addSql('DROP TABLE IF EXISTS "service_program" CASCADE;')
    this.addSql('DROP TYPE IF EXISTS "service_contract_status_enum" CASCADE;')
    this.addSql('DROP TYPE IF EXISTS "service_application_status_enum" CASCADE;')
    this.addSql('DROP TYPE IF EXISTS "service_pricing_model_enum" CASCADE;')
    this.addSql('DROP TYPE IF EXISTS "service_program_status_enum" CASCADE;')
    this.addSql('DROP TYPE IF EXISTS "service_program_type_enum" CASCADE;')
    this.addSql('DROP TYPE IF EXISTS "service_category_enum" CASCADE;')
  }
}
