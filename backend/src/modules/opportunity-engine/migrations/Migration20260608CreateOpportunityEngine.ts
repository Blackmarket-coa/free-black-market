import { Migration } from "@mikro-orm/migrations"

/**
 * Migration: create `price_observation`, `opportunity_score`, and
 * `startup_guide` tables backing the Opportunity Engine (§5), Economic
 * Intelligence (§15), and the Business Launch System startup guides (§12).
 */
export class Migration20260608CreateOpportunityEngine extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "price_observation" (
        "id" TEXT NOT NULL,
        "category" TEXT NOT NULL,
        "product_id" TEXT NULL,
        "region" TEXT NOT NULL DEFAULT 'US',
        "state" TEXT NULL,
        "unit" TEXT NOT NULL DEFAULT 'each',
        "price_cents" INTEGER NOT NULL,
        "currency_code" TEXT NOT NULL DEFAULT 'USD',
        "source" TEXT NOT NULL DEFAULT 'manual',
        "observed_at" TIMESTAMPTZ NOT NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "price_observation_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_price_observation_cat_region_time" ON "price_observation" ("category", "region", "observed_at") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_price_observation_category" ON "price_observation" ("category") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_price_observation_region" ON "price_observation" ("region") WHERE "deleted_at" IS NULL;`)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "opportunity_score" (
        "id" TEXT NOT NULL,
        "subject_type" TEXT NOT NULL DEFAULT 'CATEGORY',
        "subject_key" TEXT NOT NULL,
        "subject_label" TEXT NULL,
        "region" TEXT NOT NULL DEFAULT 'US',
        "demand_score" REAL NOT NULL DEFAULT 0,
        "competition_score" REAL NOT NULL DEFAULT 0,
        "startup_cost_score" REAL NOT NULL DEFAULT 0,
        "composite" REAL NOT NULL DEFAULT 0,
        "signals" JSONB NULL,
        "computed_at" TIMESTAMPTZ NOT NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "opportunity_score_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_opportunity_score_subject" ON "opportunity_score" ("subject_type", "subject_key", "region") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_opportunity_score_composite" ON "opportunity_score" ("composite") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_opportunity_score_region" ON "opportunity_score" ("region") WHERE "deleted_at" IS NULL;`)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "startup_guide" (
        "id" TEXT NOT NULL,
        "guide_id" TEXT NOT NULL UNIQUE,
        "slug" TEXT NOT NULL UNIQUE,
        "title" TEXT NOT NULL,
        "category" TEXT NOT NULL,
        "summary" TEXT NOT NULL,
        "estimated_startup_cost_cents" INTEGER NOT NULL DEFAULT 0,
        "difficulty" TEXT NOT NULL DEFAULT 'Beginner',
        "required_equipment" JSONB NOT NULL,
        "production_suggestions" JSONB NOT NULL,
        "related_archetypes" JSONB NOT NULL,
        "related_opportunity_key" TEXT NOT NULL,
        "is_active" BOOLEAN NOT NULL DEFAULT true,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "startup_guide_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_startup_guide_slug" ON "startup_guide" ("slug") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_startup_guide_category" ON "startup_guide" ("category") WHERE "deleted_at" IS NULL;`)
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS "price_observation";`)
    this.addSql(`DROP TABLE IF EXISTS "opportunity_score";`)
    this.addSql(`DROP TABLE IF EXISTS "startup_guide";`)
  }
}
