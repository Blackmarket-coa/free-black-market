import { Migration } from "@mikro-orm/migrations"

/**
 * Widen the onboarding wizard-step check constraint to admit `cottage_food`.
 *
 * `cottage_food` is an optional step between step_3 and step_4, traversed only
 * by sellers who make their product in a home kitchen. Widening a CHECK is
 * backwards-compatible — every existing row already holds one of the original
 * values and stays valid — so no data migration is needed.
 *
 * The constraint is dropped and re-added rather than altered because Postgres
 * has no ALTER CONSTRAINT for CHECK expressions.
 */
export class Migration20260807000100AddCottageFoodWizardStep extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      ALTER TABLE "tenancy_onboarding_state"
        DROP CONSTRAINT IF EXISTS "tenancy_onboarding_state_wizard_step_chk";
    `)
    this.addSql(`
      DO $$ BEGIN
        ALTER TABLE "tenancy_onboarding_state"
          ADD CONSTRAINT "tenancy_onboarding_state_wizard_step_chk"
          CHECK ("wizard_step" IN ('signup','step_1','step_2','step_3','cottage_food','step_4','published'));
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)
  }

  async down(): Promise<void> {
    // Park any seller sitting on the removed step at step_3 so the narrowed
    // constraint can be re-applied without failing on live rows.
    this.addSql(`
      UPDATE "tenancy_onboarding_state"
        SET "wizard_step" = 'step_3'
        WHERE "wizard_step" = 'cottage_food';
    `)
    this.addSql(`
      ALTER TABLE "tenancy_onboarding_state"
        DROP CONSTRAINT IF EXISTS "tenancy_onboarding_state_wizard_step_chk";
    `)
    this.addSql(`
      DO $$ BEGIN
        ALTER TABLE "tenancy_onboarding_state"
          ADD CONSTRAINT "tenancy_onboarding_state_wizard_step_chk"
          CHECK ("wizard_step" IN ('signup','step_1','step_2','step_3','step_4','published'));
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)
  }
}
