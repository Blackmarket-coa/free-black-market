import { Migration } from "@mikro-orm/migrations"

/**
 * Cooperative gamification: shared-goal thermometers, group "boss" quests, an
 * append-only contribution ledger, and reward-pool grants.
 */
export class Migration20260624CreateCollectiveQuest extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      DO $$ BEGIN
        CREATE TYPE "collective_goal_scope_enum" AS ENUM ('TREASURY','QUORUM','FOOD_FOREST','CUSTOM');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)
    this.addSql(`
      DO $$ BEGIN
        CREATE TYPE "collective_goal_status_enum" AS ENUM ('ACTIVE','COMPLETE');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)
    this.addSql(`
      DO $$ BEGIN
        CREATE TYPE "collective_quest_status_enum" AS ENUM ('ACTIVE','COMPLETE','EXPIRED');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "collective_goal" (
        "id" TEXT NOT NULL,
        "scope_type" collective_goal_scope_enum NOT NULL,
        "scope_id" TEXT NULL,
        "den_id" TEXT NULL,
        "title" TEXT NOT NULL,
        "description" TEXT NULL,
        "target_value" INTEGER NOT NULL,
        "current_value" INTEGER NOT NULL DEFAULT 0,
        "unit" TEXT NOT NULL DEFAULT 'units',
        "status" collective_goal_status_enum NOT NULL DEFAULT 'ACTIVE',
        "opt_in_leaderboard" BOOLEAN NOT NULL DEFAULT false,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "collective_goal_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_collective_goal_scope" ON "collective_goal" ("scope_type","scope_id") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_collective_goal_den_id" ON "collective_goal" ("den_id") WHERE "deleted_at" IS NULL;`)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "collective_quest" (
        "id" TEXT NOT NULL,
        "goal_id" TEXT NULL,
        "den_id" TEXT NULL,
        "title" TEXT NOT NULL,
        "description" TEXT NULL,
        "boss_hp" INTEGER NOT NULL,
        "hp_remaining" INTEGER NOT NULL,
        "reward_pool_xp" INTEGER NOT NULL DEFAULT 0,
        "status" collective_quest_status_enum NOT NULL DEFAULT 'ACTIVE',
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "collective_quest_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_collective_quest_den_id" ON "collective_quest" ("den_id") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_collective_quest_goal_id" ON "collective_quest" ("goal_id") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_collective_quest_status" ON "collective_quest" ("status") WHERE "deleted_at" IS NULL;`)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "quest_contribution" (
        "id" TEXT NOT NULL,
        "quest_id" TEXT NOT NULL,
        "customer_id" TEXT NOT NULL,
        "source_module" TEXT NULL,
        "source_id" TEXT NULL,
        "hp_reduction" INTEGER NOT NULL,
        "verified" BOOLEAN NOT NULL DEFAULT false,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "quest_contribution_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_quest_contribution_quest_id" ON "quest_contribution" ("quest_id") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_quest_contribution_customer_id" ON "quest_contribution" ("customer_id") WHERE "deleted_at" IS NULL;`)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "quest_reward_grant" (
        "id" TEXT NOT NULL,
        "quest_id" TEXT NOT NULL,
        "customer_id" TEXT NOT NULL,
        "xp_amount" INTEGER NOT NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "quest_reward_grant_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_quest_reward_grant_quest_id" ON "quest_reward_grant" ("quest_id") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_quest_reward_grant_customer_id" ON "quest_reward_grant" ("customer_id") WHERE "deleted_at" IS NULL;`)
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS "quest_reward_grant";`)
    this.addSql(`DROP TABLE IF EXISTS "quest_contribution";`)
    this.addSql(`DROP TABLE IF EXISTS "collective_quest";`)
    this.addSql(`DROP TABLE IF EXISTS "collective_goal";`)
    this.addSql(`DROP TYPE IF EXISTS "collective_quest_status_enum";`)
    this.addSql(`DROP TYPE IF EXISTS "collective_goal_status_enum";`)
    this.addSql(`DROP TYPE IF EXISTS "collective_goal_scope_enum";`)
  }
}
