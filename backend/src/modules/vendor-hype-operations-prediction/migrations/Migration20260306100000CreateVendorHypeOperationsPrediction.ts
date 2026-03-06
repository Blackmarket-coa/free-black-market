import { Migration } from "@mikro-orm/migrations"

export class Migration20260306100000CreateVendorHypeOperationsPrediction extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      DO $$ BEGIN
        CREATE TYPE "hype_profile_type_enum" AS ENUM ('vendor','organizer','organization');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)

    this.addSql(`
      DO $$ BEGIN
        CREATE TYPE "hype_profile_status_enum" AS ENUM ('draft','published','archived');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)

    this.addSql(`
      DO $$ BEGIN
        CREATE TYPE "ops_funding_bucket_code_enum" AS ENUM ('ops_core','production_inputs','growth','reserve','custom');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)

    this.addSql(`
      DO $$ BEGIN
        CREATE TYPE "prediction_mode_enum" AS ENUM ('non_cash','sweepstakes','regulated_cash');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)

    this.addSql(`
      DO $$ BEGIN
        CREATE TYPE "prediction_market_state_enum" AS ENUM ('draft','scheduled','open','locked','in_review','settled','voided');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)

    this.addSql(`
      DO $$ BEGIN
        CREATE TYPE "prediction_stake_unit_enum" AS ENUM ('points','currency');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)

    this.addSql(`
      DO $$ BEGIN
        CREATE TYPE "prediction_position_status_enum" AS ENUM ('open','won','lost','voided');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)

    this.addSql(`
      DO $$ BEGIN
        CREATE TYPE "prediction_settlement_status_enum" AS ENUM ('proposed','final','reversed');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "hype_profile" (
        "id" TEXT NOT NULL,
        "profile_type" hype_profile_type_enum NOT NULL,
        "owner_id" TEXT NOT NULL,
        "slug" TEXT NOT NULL,
        "display_name" TEXT NOT NULL,
        "mission" TEXT NOT NULL,
        "story_markdown" TEXT NULL,
        "trust_score" INTEGER NULL,
        "readiness_score" INTEGER NULL,
        "capital_need_amount" NUMERIC NULL,
        "status" hype_profile_status_enum NOT NULL DEFAULT 'draft',
        "published_at" TIMESTAMPTZ NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "hype_profile_pkey" PRIMARY KEY ("id")
      );
    `)

    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_hype_profile_owner" ON "hype_profile" ("owner_id") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_hype_profile_slug" ON "hype_profile" ("slug") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_hype_profile_slug_unique" ON "hype_profile" ("slug") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_hype_profile_status" ON "hype_profile" ("status") WHERE "deleted_at" IS NULL;`)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "ops_funding_bucket" (
        "id" TEXT NOT NULL,
        "profile_id" TEXT NOT NULL,
        "code" ops_funding_bucket_code_enum NOT NULL,
        "name" TEXT NOT NULL,
        "description" TEXT NULL,
        "is_active" BOOLEAN NOT NULL DEFAULT true,
        "display_order" INTEGER NOT NULL DEFAULT 0,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "ops_funding_bucket_pkey" PRIMARY KEY ("id")
      );
    `)

    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_ops_bucket_profile" ON "ops_funding_bucket" ("profile_id") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_ops_bucket_profile_code" ON "ops_funding_bucket" ("profile_id", "code") WHERE "deleted_at" IS NULL;`)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "prediction_market" (
        "id" TEXT NOT NULL,
        "profile_id" TEXT NOT NULL,
        "milestone_id" TEXT NULL,
        "title" TEXT NOT NULL,
        "description" TEXT NULL,
        "mode" prediction_mode_enum NOT NULL DEFAULT 'non_cash',
        "jurisdiction_code" TEXT NOT NULL,
        "policy_version" TEXT NOT NULL,
        "oracle_config_id" TEXT NOT NULL,
        "starts_at" TIMESTAMPTZ NOT NULL,
        "locks_at" TIMESTAMPTZ NOT NULL,
        "settlement_deadline_at" TIMESTAMPTZ NULL,
        "payout_cap_config" JSONB NULL,
        "state" prediction_market_state_enum NOT NULL DEFAULT 'draft',
        "created_by" TEXT NOT NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "prediction_market_pkey" PRIMARY KEY ("id")
      );
    `)

    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_prediction_market_profile" ON "prediction_market" ("profile_id") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_prediction_market_state" ON "prediction_market" ("state") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_prediction_market_policy_gate" ON "prediction_market" ("jurisdiction_code", "mode", "state") WHERE "deleted_at" IS NULL;`)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "prediction_position" (
        "id" TEXT NOT NULL,
        "market_id" TEXT NOT NULL,
        "supporter_id" TEXT NOT NULL,
        "outcome_option_key" TEXT NOT NULL,
        "stake_amount" NUMERIC NOT NULL,
        "stake_unit" prediction_stake_unit_enum NOT NULL DEFAULT 'points',
        "max_payout_amount" NUMERIC NULL,
        "status" prediction_position_status_enum NOT NULL DEFAULT 'open',
        "idempotency_key" TEXT NOT NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "prediction_position_pkey" PRIMARY KEY ("id")
      );
    `)

    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_prediction_position_market" ON "prediction_position" ("market_id") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_prediction_position_supporter" ON "prediction_position" ("supporter_id") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_prediction_position_idempotency" ON "prediction_position" ("market_id", "supporter_id", "idempotency_key") WHERE "deleted_at" IS NULL;`)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "prediction_settlement" (
        "id" TEXT NOT NULL,
        "market_id" TEXT NOT NULL,
        "settlement_ref" TEXT NOT NULL,
        "oracle_outcome_key" TEXT NOT NULL,
        "oracle_evidence_uri" TEXT NOT NULL,
        "settled_at" TIMESTAMPTZ NOT NULL,
        "dispute_window_ends_at" TIMESTAMPTZ NULL,
        "status" prediction_settlement_status_enum NOT NULL DEFAULT 'proposed',
        "executed_by" TEXT NOT NULL DEFAULT 'system',
        "execution_run_id" TEXT NOT NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "prediction_settlement_pkey" PRIMARY KEY ("id")
      );
    `)

    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_prediction_settlement_market" ON "prediction_settlement" ("market_id") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_prediction_settlement_ref" ON "prediction_settlement" ("settlement_ref") WHERE "deleted_at" IS NULL;`)
  }

  async down(): Promise<void> {
    this.addSql('DROP TABLE IF EXISTS "prediction_settlement" CASCADE;')
    this.addSql('DROP TABLE IF EXISTS "prediction_position" CASCADE;')
    this.addSql('DROP TABLE IF EXISTS "prediction_market" CASCADE;')
    this.addSql('DROP TABLE IF EXISTS "ops_funding_bucket" CASCADE;')
    this.addSql('DROP TABLE IF EXISTS "hype_profile" CASCADE;')

    this.addSql('DROP TYPE IF EXISTS "prediction_settlement_status_enum";')
    this.addSql('DROP TYPE IF EXISTS "prediction_position_status_enum";')
    this.addSql('DROP TYPE IF EXISTS "prediction_stake_unit_enum";')
    this.addSql('DROP TYPE IF EXISTS "prediction_market_state_enum";')
    this.addSql('DROP TYPE IF EXISTS "prediction_mode_enum";')
    this.addSql('DROP TYPE IF EXISTS "ops_funding_bucket_code_enum";')
    this.addSql('DROP TYPE IF EXISTS "hype_profile_status_enum";')
    this.addSql('DROP TYPE IF EXISTS "hype_profile_type_enum";')
  }
}
