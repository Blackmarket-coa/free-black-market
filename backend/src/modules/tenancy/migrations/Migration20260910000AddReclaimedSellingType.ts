import { Migration } from "@mikro-orm/migrations"

/**
 * Allow `reclaimed` as an onboarding selling type.
 *
 * `Migration20260506500OnboardingWizardFields` pinned `selling_type` to four
 * values with a CHECK constraint, so adding the fifth to the TypeScript enum
 * alone would have every write rejected by Postgres. The constraint is
 * dropped and recreated rather than altered because Postgres has no
 * ALTER CONSTRAINT for a CHECK expression.
 *
 * Widening only — every previously valid value stays valid, so the up
 * migration cannot fail on existing rows. The down migration narrows, and so
 * it clears any `reclaimed` row back to NULL first; without that it would
 * fail on exactly the data it is meant to roll back.
 */
export class Migration20260910000AddReclaimedSellingType extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      ALTER TABLE "tenancy_onboarding_state"
        DROP CONSTRAINT IF EXISTS "tenancy_onboarding_state_selling_type_chk";
    `)
    this.addSql(`
      ALTER TABLE "tenancy_onboarding_state"
        ADD CONSTRAINT "tenancy_onboarding_state_selling_type_chk"
        CHECK ("selling_type" IS NULL OR "selling_type" IN ('physical','digital','service','event_class','reclaimed'));
    `)
  }

  async down(): Promise<void> {
    this.addSql(`
      ALTER TABLE "tenancy_onboarding_state"
        DROP CONSTRAINT IF EXISTS "tenancy_onboarding_state_selling_type_chk";
    `)
    this.addSql(`
      UPDATE "tenancy_onboarding_state"
        SET "selling_type" = NULL
        WHERE "selling_type" = 'reclaimed';
    `)
    this.addSql(`
      ALTER TABLE "tenancy_onboarding_state"
        ADD CONSTRAINT "tenancy_onboarding_state_selling_type_chk"
        CHECK ("selling_type" IS NULL OR "selling_type" IN ('physical','digital','service','event_class'));
    `)
  }
}
