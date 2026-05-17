import { Migration } from "@mikro-orm/migrations"

/**
 * Phase 1 / Slice B — per-program referral level configuration.
 *
 * Additive: two nullable/defaulted columns on creator_program. Programs
 * with `max_referral_levels = 1` (the default) keep today's single-level
 * behavior. `referral_level_splits` is a JSON object mapping level names
 * (`L1`, `L2`, `L3`) to integer percentages summing to <=100; used by
 * CreatorAttributionService.attributeOrder to allocate per-level
 * commission_amount_cents.
 */
export class Migration20260616AddReferralLevels extends Migration {
  async up(): Promise<void> {
    this.addSql(
      'ALTER TABLE "creator_program" ADD COLUMN IF NOT EXISTS "max_referral_levels" INTEGER NOT NULL DEFAULT 1;'
    )
    this.addSql(
      'ALTER TABLE "creator_program" ADD COLUMN IF NOT EXISTS "referral_level_splits" JSONB NULL;'
    )
  }

  async down(): Promise<void> {
    this.addSql(
      'ALTER TABLE "creator_program" DROP COLUMN IF EXISTS "referral_level_splits";'
    )
    this.addSql(
      'ALTER TABLE "creator_program" DROP COLUMN IF EXISTS "max_referral_levels";'
    )
  }
}
