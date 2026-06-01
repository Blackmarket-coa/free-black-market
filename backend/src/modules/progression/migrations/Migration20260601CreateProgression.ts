import { Migration } from "@mikro-orm/migrations"

export class Migration20260601CreateProgression extends Migration {
  async up(): Promise<void> {
    // ── Enums ───────────────────────────────────────────────────────────
    this.addSql(`
      DO $$ BEGIN
        CREATE TYPE "stance_enum" AS ENUM (
          'producer','consumer','investor','coalition','creator'
        );
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)

    // ── character_sheet ─────────────────────────────────────────────────
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "character_sheet" (
        "id" TEXT NOT NULL,
        "customer_id" TEXT NOT NULL,
        "active_stance" stance_enum NOT NULL DEFAULT 'consumer',
        "producer_xp" INTEGER NOT NULL DEFAULT 0,
        "producer_level" INTEGER NOT NULL DEFAULT 0,
        "consumer_xp" INTEGER NOT NULL DEFAULT 0,
        "consumer_level" INTEGER NOT NULL DEFAULT 0,
        "investor_xp" INTEGER NOT NULL DEFAULT 0,
        "investor_level" INTEGER NOT NULL DEFAULT 0,
        "coalition_xp" INTEGER NOT NULL DEFAULT 0,
        "coalition_level" INTEGER NOT NULL DEFAULT 0,
        "creator_xp" INTEGER NOT NULL DEFAULT 0,
        "creator_level" INTEGER NOT NULL DEFAULT 0,
        "total_xp" INTEGER NOT NULL DEFAULT 0,
        "food_produced_cents" NUMERIC NOT NULL DEFAULT 0,
        "orders_completed" INTEGER NOT NULL DEFAULT 0,
        "capital_deployed_cents" NUMERIC NOT NULL DEFAULT 0,
        "mutual_aid_contributions" INTEGER NOT NULL DEFAULT 0,
        "trust_score" INTEGER NOT NULL DEFAULT 0,
        "karma" INTEGER NOT NULL DEFAULT 0,
        "time_credits" INTEGER NOT NULL DEFAULT 0,
        "earned_titles" JSONB NULL,
        "last_recomputed_at" TIMESTAMPTZ NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "character_sheet_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_character_sheet_customer_id" ON "character_sheet" ("customer_id") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_character_sheet_active_stance" ON "character_sheet" ("active_stance") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_character_sheet_total_xp" ON "character_sheet" ("total_xp") WHERE "deleted_at" IS NULL;`)

    // ── xp_event ────────────────────────────────────────────────────────
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "xp_event" (
        "id" TEXT NOT NULL,
        "customer_id" TEXT NOT NULL,
        "role" stance_enum NOT NULL,
        "amount" INTEGER NOT NULL,
        "reason" TEXT NOT NULL,
        "source_module" TEXT NULL,
        "source_id" TEXT NULL,
        "occurred_at" TIMESTAMPTZ NOT NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "xp_event_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_xp_event_customer_id" ON "xp_event" ("customer_id") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_xp_event_reason" ON "xp_event" ("reason") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_xp_event_source" ON "xp_event" ("source_module", "source_id") WHERE "deleted_at" IS NULL;`)

    // ── progression_title ───────────────────────────────────────────────
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "progression_title" (
        "id" TEXT NOT NULL,
        "slug" TEXT NOT NULL,
        "role" stance_enum NOT NULL,
        "name" TEXT NOT NULL,
        "description" TEXT NOT NULL,
        "min_level" INTEGER NOT NULL DEFAULT 1,
        "icon" TEXT NULL,
        "color" TEXT NULL,
        "display_order" INTEGER NOT NULL DEFAULT 0,
        "active" BOOLEAN NOT NULL DEFAULT true,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "progression_title_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_progression_title_slug" ON "progression_title" ("slug") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_progression_title_role" ON "progression_title" ("role") WHERE "deleted_at" IS NULL;`)
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS "xp_event";`)
    this.addSql(`DROP TABLE IF EXISTS "progression_title";`)
    this.addSql(`DROP TABLE IF EXISTS "character_sheet";`)
    this.addSql(`DROP TYPE IF EXISTS "stance_enum";`)
  }
}
