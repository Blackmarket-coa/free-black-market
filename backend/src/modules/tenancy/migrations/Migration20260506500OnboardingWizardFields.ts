import { Migration } from "@mikro-orm/migrations"

/**
 * Sprint A onboarding wizard fields on tenancy_onboarding_state. All
 * additions are nullable / defaulted so existing rows remain valid.
 */
export class Migration20260506500OnboardingWizardFields extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      ALTER TABLE "tenancy_onboarding_state"
        ADD COLUMN IF NOT EXISTS "seller_id" TEXT NULL,
        ADD COLUMN IF NOT EXISTS "selling_type" TEXT NULL,
        ADD COLUMN IF NOT EXISTS "wizard_step" TEXT NOT NULL DEFAULT 'signup',
        ADD COLUMN IF NOT EXISTS "wizard_step_completed_at" JSONB NULL,
        ADD COLUMN IF NOT EXISTS "wizard_started_at" TIMESTAMPTZ NULL,
        ADD COLUMN IF NOT EXISTS "first_published_listing_id" TEXT NULL,
        ADD COLUMN IF NOT EXISTS "first_published_at" TIMESTAMPTZ NULL,
        ADD COLUMN IF NOT EXISTS "payout_deferred_until_first_sale" BOOLEAN NOT NULL DEFAULT true;
    `)
    this.addSql(`
      DO $$ BEGIN
        ALTER TABLE "tenancy_onboarding_state"
          ADD CONSTRAINT "tenancy_onboarding_state_selling_type_chk"
          CHECK ("selling_type" IS NULL OR "selling_type" IN ('physical','digital','service','event_class'));
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)
    this.addSql(`
      DO $$ BEGIN
        ALTER TABLE "tenancy_onboarding_state"
          ADD CONSTRAINT "tenancy_onboarding_state_wizard_step_chk"
          CHECK ("wizard_step" IN ('signup','step_1','step_2','step_3','step_4','published'));
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_onboarding_seller" ON "tenancy_onboarding_state" ("seller_id") WHERE "seller_id" IS NOT NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_onboarding_wizard_step" ON "tenancy_onboarding_state" ("wizard_step");`)
  }

  async down(): Promise<void> {
    this.addSql(`DROP INDEX IF EXISTS "IDX_onboarding_seller";`)
    this.addSql(`DROP INDEX IF EXISTS "IDX_onboarding_wizard_step";`)
    this.addSql(`
      ALTER TABLE "tenancy_onboarding_state"
        DROP CONSTRAINT IF EXISTS "tenancy_onboarding_state_wizard_step_chk",
        DROP CONSTRAINT IF EXISTS "tenancy_onboarding_state_selling_type_chk",
        DROP COLUMN IF EXISTS "seller_id",
        DROP COLUMN IF EXISTS "selling_type",
        DROP COLUMN IF EXISTS "wizard_step",
        DROP COLUMN IF EXISTS "wizard_step_completed_at",
        DROP COLUMN IF EXISTS "wizard_started_at",
        DROP COLUMN IF EXISTS "first_published_listing_id",
        DROP COLUMN IF EXISTS "first_published_at",
        DROP COLUMN IF EXISTS "payout_deferred_until_first_sale";
    `)
  }
}
