import { Migration } from "@mikro-orm/migrations"

export class Migration20260710CreateCreatorRewards extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      DO $$ BEGIN
        CREATE TYPE "content_post_verification_status_enum" AS ENUM (
          'unverified', 'verified', 'rejected'
        );
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)
    this.addSql(`
      DO $$ BEGIN
        CREATE TYPE "reward_pool_kind_enum" AS ENUM (
          'engagement', 'throughput'
        );
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)
    this.addSql(`
      DO $$ BEGIN
        CREATE TYPE "reward_pool_status_enum" AS ENUM (
          'scheduled', 'accruing', 'calculating', 'distributed', 'reverted'
        );
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)
    this.addSql(`
      DO $$ BEGIN
        CREATE TYPE "reward_payout_status_enum" AS ENUM (
          'pending', 'held', 'paid', 'reversed'
        );
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "content_post" (
        "id" TEXT NOT NULL,
        "creator_seller_id" TEXT NOT NULL,
        "deal_id" TEXT NULL,
        "program_id" TEXT NULL,
        "platform" TEXT NOT NULL,
        "external_post_id" TEXT NOT NULL,
        "external_url" TEXT NOT NULL,
        "caption" TEXT NULL,
        "thumbnail_url" TEXT NULL,
        "affiliate_link_id" TEXT NULL,
        "verification_status" content_post_verification_status_enum NOT NULL DEFAULT 'unverified',
        "verified_at" TIMESTAMPTZ NULL,
        "verified_via" TEXT NULL,
        "qualified" BOOLEAN NOT NULL DEFAULT FALSE,
        "disqualified_reason" TEXT NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "content_post_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_content_post_creator" ON "content_post" ("creator_seller_id");`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_content_post_deal" ON "content_post" ("deal_id");`)
    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_content_post_platform_post"
        ON "content_post" ("platform", "external_post_id")
        WHERE "deleted_at" IS NULL;
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_content_post_verification" ON "content_post" ("verification_status");`)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "engagement_snapshot" (
        "id" TEXT NOT NULL,
        "content_post_id" TEXT NOT NULL,
        "captured_at" TIMESTAMPTZ NOT NULL,
        "views" NUMERIC NOT NULL DEFAULT 0,
        "qualified_views" NUMERIC NOT NULL DEFAULT 0,
        "likes" NUMERIC NOT NULL DEFAULT 0,
        "shares" NUMERIC NOT NULL DEFAULT 0,
        "comments" NUMERIC NOT NULL DEFAULT 0,
        "saves" NUMERIC NOT NULL DEFAULT 0,
        "watch_time_seconds" NUMERIC NOT NULL DEFAULT 0,
        "raw" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "engagement_snapshot_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_engagement_snapshot_post_time"
        ON "engagement_snapshot" ("content_post_id", "captured_at");
    `)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "reward_pool" (
        "id" TEXT NOT NULL,
        "program_id" TEXT NULL,
        "funder_seller_id" TEXT NULL,
        "kind" reward_pool_kind_enum NOT NULL DEFAULT 'engagement',
        "period_start" TIMESTAMPTZ NOT NULL,
        "period_end" TIMESTAMPTZ NOT NULL,
        "total_cents" NUMERIC NOT NULL,
        "rate_per_kqv_cents" NUMERIC NULL,
        "currency_code" TEXT NOT NULL DEFAULT 'usd',
        "status" reward_pool_status_enum NOT NULL DEFAULT 'scheduled',
        "distributed_at" TIMESTAMPTZ NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "reward_pool_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_reward_pool_program" ON "reward_pool" ("program_id");`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_reward_pool_status_end" ON "reward_pool" ("status", "period_end");`)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "reward_payout" (
        "id" TEXT NOT NULL,
        "pool_id" TEXT NOT NULL,
        "creator_seller_id" TEXT NOT NULL,
        "qualified_views" NUMERIC NOT NULL DEFAULT 0,
        "qualified_engagement_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "amount_cents" NUMERIC NOT NULL,
        "currency_code" TEXT NOT NULL DEFAULT 'usd',
        "status" reward_payout_status_enum NOT NULL DEFAULT 'pending',
        "ledger_entry_id" TEXT NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "reward_payout_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_reward_payout_pool" ON "reward_payout" ("pool_id");`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_reward_payout_creator_status" ON "reward_payout" ("creator_seller_id", "status");`)
  }

  async down(): Promise<void> {
    this.addSql('DROP TABLE IF EXISTS "reward_payout" CASCADE;')
    this.addSql('DROP TABLE IF EXISTS "reward_pool" CASCADE;')
    this.addSql('DROP TABLE IF EXISTS "engagement_snapshot" CASCADE;')
    this.addSql('DROP TABLE IF EXISTS "content_post" CASCADE;')
    this.addSql('DROP TYPE IF EXISTS "reward_payout_status_enum" CASCADE;')
    this.addSql('DROP TYPE IF EXISTS "reward_pool_status_enum" CASCADE;')
    this.addSql('DROP TYPE IF EXISTS "reward_pool_kind_enum" CASCADE;')
    this.addSql('DROP TYPE IF EXISTS "content_post_verification_status_enum" CASCADE;')
  }
}
