import { Migration } from "@mikro-orm/migrations"

export class Migration20260306130000AddKeyManagementAndSafetyControls extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      DO $$ BEGIN
        CREATE TYPE "oracle_signing_key_status_enum" AS ENUM ('active','retiring','retired');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)

    this.addSql(`
      DO $$ BEGIN
        CREATE TYPE "prediction_safety_risk_enum" AS ENUM ('low','medium','high');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "oracle_signing_key" (
        "id" TEXT NOT NULL,
        "key_id" TEXT NOT NULL,
        "algorithm" TEXT NOT NULL DEFAULT 'ed25519',
        "public_key_pem" TEXT NOT NULL,
        "status" oracle_signing_key_status_enum NOT NULL DEFAULT 'active',
        "valid_from" TIMESTAMPTZ NOT NULL,
        "valid_to" TIMESTAMPTZ NULL,
        "rotation_note" TEXT NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "oracle_signing_key_pkey" PRIMARY KEY ("id")
      );
    `)

    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_oracle_signing_key_key_id" ON "oracle_signing_key" ("key_id") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_oracle_signing_key_status" ON "oracle_signing_key" ("status") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_oracle_signing_key_algo_status" ON "oracle_signing_key" ("algorithm", "status") WHERE "deleted_at" IS NULL;`)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "user_prediction_safety" (
        "id" TEXT NOT NULL,
        "supporter_id" TEXT NOT NULL,
        "self_excluded_until" TIMESTAMPTZ NULL,
        "cooldown_until" TIMESTAMPTZ NULL,
        "daily_position_limit" INTEGER NOT NULL DEFAULT 20,
        "daily_positions_count" INTEGER NOT NULL DEFAULT 0,
        "daily_counter_date" TEXT NULL,
        "last_position_at" TIMESTAMPTZ NULL,
        "risk_level" prediction_safety_risk_enum NOT NULL DEFAULT 'low',
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "user_prediction_safety_pkey" PRIMARY KEY ("id")
      );
    `)

    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_prediction_safety_supporter" ON "user_prediction_safety" ("supporter_id") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_prediction_safety_risk" ON "user_prediction_safety" ("risk_level") WHERE "deleted_at" IS NULL;`)
  }

  async down(): Promise<void> {
    this.addSql('DROP TABLE IF EXISTS "user_prediction_safety" CASCADE;')
    this.addSql('DROP TABLE IF EXISTS "oracle_signing_key" CASCADE;')
    this.addSql('DROP TYPE IF EXISTS "prediction_safety_risk_enum";')
    this.addSql('DROP TYPE IF EXISTS "oracle_signing_key_status_enum";')
  }
}
