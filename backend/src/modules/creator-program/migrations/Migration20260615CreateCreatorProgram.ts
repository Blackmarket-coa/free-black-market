import { Migration } from "@mikro-orm/migrations"

export class Migration20260615CreateCreatorProgram extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      DO $$ BEGIN
        CREATE TYPE "creator_program_type_enum" AS ENUM (
          'affiliate_open', 'affiliate_invite', 'sponsored_brief',
          'commission_boost', 'engagement_pool'
        );
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)

    this.addSql(`
      DO $$ BEGIN
        CREATE TYPE "creator_program_status_enum" AS ENUM (
          'draft', 'active', 'paused', 'closed', 'archived'
        );
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)

    this.addSql(`
      DO $$ BEGIN
        CREATE TYPE "creator_program_attribution_model_enum" AS ENUM (
          'last_click', 'first_click', 'linear'
        );
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)

    this.addSql(`
      DO $$ BEGIN
        CREATE TYPE "creator_application_status_enum" AS ENUM (
          'pending', 'approved', 'rejected', 'withdrawn'
        );
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)

    this.addSql(`
      DO $$ BEGIN
        CREATE TYPE "creator_deal_status_enum" AS ENUM (
          'active', 'fulfilled', 'violated', 'expired', 'canceled'
        );
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "creator_program" (
        "id" TEXT NOT NULL,
        "vendor_id" TEXT NOT NULL,
        "title" TEXT NOT NULL,
        "slug" TEXT NOT NULL,
        "description" TEXT NULL,
        "brief_markdown" TEXT NULL,
        "program_type" creator_program_type_enum NOT NULL,
        "status" creator_program_status_enum NOT NULL DEFAULT 'draft',
        "commission_percent" NUMERIC NULL,
        "commission_flat_cents" INTEGER NULL,
        "sponsorship_flat_cents" INTEGER NULL,
        "pool_total_cents" INTEGER NULL,
        "pool_period" TEXT NULL,
        "cookie_window_days" INTEGER NOT NULL DEFAULT 7,
        "hold_days" INTEGER NOT NULL DEFAULT 7,
        "attribution_model" creator_program_attribution_model_enum NOT NULL DEFAULT 'last_click',
        "currency_code" TEXT NOT NULL DEFAULT 'usd',
        "product_ids" JSONB NULL,
        "collection_ids" JSONB NULL,
        "category_ids" JSONB NULL,
        "required_platforms" JSONB NULL,
        "min_followers" INTEGER NULL,
        "geo_allowlist" JSONB NULL,
        "starts_at" TIMESTAMPTZ NULL,
        "ends_at" TIMESTAMPTZ NULL,
        "budget_cap_cents" INTEGER NULL,
        "budget_spent_cents" INTEGER NOT NULL DEFAULT 0,
        "requires_kyc" BOOLEAN NOT NULL DEFAULT FALSE,
        "min_verification_level" TEXT NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "creator_program_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_creator_program_vendor" ON "creator_program" ("vendor_id");`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_creator_program_status" ON "creator_program" ("status");`)
    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_creator_program_vendor_slug"
        ON "creator_program" ("vendor_id", "slug")
        WHERE "deleted_at" IS NULL;
    `)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "creator_application" (
        "id" TEXT NOT NULL,
        "program_id" TEXT NOT NULL,
        "creator_seller_id" TEXT NOT NULL,
        "pitch" TEXT NULL,
        "proposed_platforms" JSONB NULL,
        "follower_snapshot" JSONB NULL,
        "status" creator_application_status_enum NOT NULL DEFAULT 'pending',
        "decided_at" TIMESTAMPTZ NULL,
        "decided_by" TEXT NULL,
        "decision_reason" TEXT NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "creator_application_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_creator_application_program" ON "creator_application" ("program_id");`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_creator_application_creator" ON "creator_application" ("creator_seller_id");`)
    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_creator_application"
        ON "creator_application" ("program_id", "creator_seller_id")
        WHERE "deleted_at" IS NULL;
    `)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "creator_deal" (
        "id" TEXT NOT NULL,
        "program_id" TEXT NOT NULL,
        "application_id" TEXT NOT NULL,
        "creator_seller_id" TEXT NOT NULL,
        "vendor_id" TEXT NOT NULL,
        "status" creator_deal_status_enum NOT NULL DEFAULT 'active',
        "effective_from" TIMESTAMPTZ NOT NULL,
        "effective_until" TIMESTAMPTZ NULL,
        "terms_snapshot" JSONB NOT NULL,
        "total_attributed_cents" NUMERIC NOT NULL DEFAULT 0,
        "total_paid_out_cents" NUMERIC NOT NULL DEFAULT 0,
        "default_affiliate_link_id" TEXT NULL,
        "violation_reason" TEXT NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "creator_deal_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_creator_deal_creator_status" ON "creator_deal" ("creator_seller_id", "status");`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_creator_deal_program" ON "creator_deal" ("program_id");`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_creator_deal_vendor" ON "creator_deal" ("vendor_id");`)
  }

  async down(): Promise<void> {
    this.addSql('DROP TABLE IF EXISTS "creator_deal" CASCADE;')
    this.addSql('DROP TABLE IF EXISTS "creator_application" CASCADE;')
    this.addSql('DROP TABLE IF EXISTS "creator_program" CASCADE;')
    this.addSql('DROP TYPE IF EXISTS "creator_deal_status_enum" CASCADE;')
    this.addSql('DROP TYPE IF EXISTS "creator_application_status_enum" CASCADE;')
    this.addSql('DROP TYPE IF EXISTS "creator_program_attribution_model_enum" CASCADE;')
    this.addSql('DROP TYPE IF EXISTS "creator_program_status_enum" CASCADE;')
    this.addSql('DROP TYPE IF EXISTS "creator_program_type_enum" CASCADE;')
  }
}
