import { Migration } from "@mikro-orm/migrations"

/**
 * Phase 1 / Slice C — quick onboarding path + referral capture columns.
 *
 * Additive: nullable + defaulted columns on tenancy_onboarding_state.
 */
export class Migration20260520206AddQuickPath extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      ALTER TABLE "tenancy_onboarding_state"
        ADD COLUMN IF NOT EXISTS "quick_path_used" BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "referred_by_seller_id" TEXT NULL;
    `)
    this.addSql(
      'CREATE INDEX IF NOT EXISTS "IDX_onboarding_referred_by" ON "tenancy_onboarding_state" ("referred_by_seller_id") WHERE "referred_by_seller_id" IS NOT NULL;'
    )
  }

  async down(): Promise<void> {
    this.addSql('DROP INDEX IF EXISTS "IDX_onboarding_referred_by";')
    this.addSql(`
      ALTER TABLE "tenancy_onboarding_state"
        DROP COLUMN IF EXISTS "referred_by_seller_id",
        DROP COLUMN IF EXISTS "quick_path_used";
    `)
  }
}
