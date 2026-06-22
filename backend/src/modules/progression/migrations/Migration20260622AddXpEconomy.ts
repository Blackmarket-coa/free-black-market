import { Migration } from "@mikro-orm/migrations"

/**
 * Stage 2 XP economy: dual balance + redemption ledger.
 *  - Adds `spendable_xp` to character_sheet (separate from lifetime total_xp).
 *  - Creates the `xp_redemption` append-only spend ledger.
 */
export class Migration20260622AddXpEconomy extends Migration {
  async up(): Promise<void> {
    // ── character_sheet.spendable_xp ────────────────────────────────────
    this.addSql(
      `ALTER TABLE "character_sheet" ADD COLUMN IF NOT EXISTS "spendable_xp" INTEGER NOT NULL DEFAULT 0;`
    )

    // ── enums ───────────────────────────────────────────────────────────
    this.addSql(`
      DO $$ BEGIN
        CREATE TYPE "xp_redemption_status_enum" AS ENUM (
          'pending','fulfilled','refunded'
        );
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)
    this.addSql(`
      DO $$ BEGIN
        CREATE TYPE "xp_reward_kind_enum" AS ENUM (
          'entitlement','digital_download'
        );
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)

    // ── xp_redemption ───────────────────────────────────────────────────
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "xp_redemption" (
        "id" TEXT NOT NULL,
        "customer_id" TEXT NOT NULL,
        "reward_key" TEXT NOT NULL,
        "reward_name" TEXT NOT NULL,
        "reward_kind" xp_reward_kind_enum NOT NULL,
        "xp_cost" INTEGER NOT NULL,
        "feature_key" TEXT NULL,
        "status" xp_redemption_status_enum NOT NULL DEFAULT 'pending',
        "entitlement_id" TEXT NULL,
        "fulfilled_at" TIMESTAMPTZ NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "xp_redemption_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_xp_redemption_customer_id" ON "xp_redemption" ("customer_id") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_xp_redemption_reward_key" ON "xp_redemption" ("reward_key") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_xp_redemption_status" ON "xp_redemption" ("status") WHERE "deleted_at" IS NULL;`)
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS "xp_redemption";`)
    this.addSql(`DROP TYPE IF EXISTS "xp_reward_kind_enum";`)
    this.addSql(`DROP TYPE IF EXISTS "xp_redemption_status_enum";`)
    this.addSql(`ALTER TABLE "character_sheet" DROP COLUMN IF EXISTS "spendable_xp";`)
  }
}
