import { Migration } from "@mikro-orm/migrations"

/**
 * Vendor Quest engine: opt-in enrollments, an append-only stage-event ledger,
 * generated packet records, and collective-quest grouping + per-member consent.
 * Quest *definitions* are code config (not tables). Additive and feature-flagged
 * (VENDOR_QUESTS_V1); nothing here is auto-created for a vendor.
 */
export class Migration20260701CreateVendorQuest extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      DO $$ BEGIN
        CREATE TYPE "quest_enrollment_status_enum" AS ENUM ('ACTIVE','DROPPED','COMPLETE');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)
    this.addSql(`
      DO $$ BEGIN
        CREATE TYPE "quest_collective_status_enum" AS ENUM ('FORMING','ACTIVE','COMPLETE','DISBANDED');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "quest_enrollment" (
        "id" TEXT NOT NULL,
        "seller_id" TEXT NOT NULL,
        "quest_key" TEXT NOT NULL,
        "status" quest_enrollment_status_enum NOT NULL DEFAULT 'ACTIVE',
        "current_stage" INTEGER NOT NULL DEFAULT 0,
        "collective_id" TEXT NULL,
        "enrolled_at" TIMESTAMPTZ NOT NULL,
        "dropped_at" TIMESTAMPTZ NULL,
        "completed_at" TIMESTAMPTZ NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "quest_enrollment_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_quest_enrollment_seller_id" ON "quest_enrollment" ("seller_id") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_quest_enrollment_quest_key" ON "quest_enrollment" ("quest_key") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_quest_enrollment_status" ON "quest_enrollment" ("status") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_quest_enrollment_collective_id" ON "quest_enrollment" ("collective_id") WHERE "deleted_at" IS NULL;`)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "quest_stage_event" (
        "id" TEXT NOT NULL,
        "enrollment_id" TEXT NOT NULL,
        "seller_id" TEXT NOT NULL,
        "quest_key" TEXT NOT NULL,
        "from_stage" INTEGER NOT NULL,
        "to_stage" INTEGER NOT NULL,
        "stage_key" TEXT NULL,
        "evaluated_snapshot" JSONB NULL,
        "xp_awarded" INTEGER NOT NULL DEFAULT 0,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "quest_stage_event_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_quest_stage_event_enrollment_id" ON "quest_stage_event" ("enrollment_id") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_quest_stage_event_seller_id" ON "quest_stage_event" ("seller_id") WHERE "deleted_at" IS NULL;`)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "quest_packet" (
        "id" TEXT NOT NULL,
        "enrollment_id" TEXT NOT NULL,
        "seller_id" TEXT NOT NULL,
        "quest_key" TEXT NOT NULL,
        "packet_key" TEXT NOT NULL,
        "export_json" JSONB NULL,
        "file_id" TEXT NULL,
        "disclaimer" TEXT NOT NULL,
        "remaining_items" JSONB NULL,
        "generated_at" TIMESTAMPTZ NOT NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "quest_packet_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_quest_packet_enrollment_id" ON "quest_packet" ("enrollment_id") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_quest_packet_seller_id" ON "quest_packet" ("seller_id") WHERE "deleted_at" IS NULL;`)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "quest_collective" (
        "id" TEXT NOT NULL,
        "quest_key" TEXT NOT NULL,
        "title" TEXT NOT NULL,
        "owner_seller_id" TEXT NOT NULL,
        "status" quest_collective_status_enum NOT NULL DEFAULT 'FORMING',
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "quest_collective_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_quest_collective_quest_key" ON "quest_collective" ("quest_key") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_quest_collective_owner" ON "quest_collective" ("owner_seller_id") WHERE "deleted_at" IS NULL;`)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "quest_member_consent" (
        "id" TEXT NOT NULL,
        "collective_id" TEXT NOT NULL,
        "seller_id" TEXT NOT NULL,
        "consent_scopes" JSONB NOT NULL,
        "consented_at" TIMESTAMPTZ NOT NULL,
        "revoked_at" TIMESTAMPTZ NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "quest_member_consent_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_quest_member_consent_collective_id" ON "quest_member_consent" ("collective_id") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_quest_member_consent_seller_id" ON "quest_member_consent" ("seller_id") WHERE "deleted_at" IS NULL;`)
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS "quest_member_consent";`)
    this.addSql(`DROP TABLE IF EXISTS "quest_collective";`)
    this.addSql(`DROP TABLE IF EXISTS "quest_packet";`)
    this.addSql(`DROP TABLE IF EXISTS "quest_stage_event";`)
    this.addSql(`DROP TABLE IF EXISTS "quest_enrollment";`)
    this.addSql(`DROP TYPE IF EXISTS "quest_collective_status_enum";`)
    this.addSql(`DROP TYPE IF EXISTS "quest_enrollment_status_enum";`)
  }
}
