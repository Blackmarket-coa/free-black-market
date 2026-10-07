import { Migration } from "@mikro-orm/migrations"

/**
 * `hawala_card_charge_state.dispute_fee_cents` (operator answer 2026-10-07:
 * the vendor whose order was disputed owes Stripe's dispute fee): the fees
 * Stripe took on the charge's disputes, as Stripe reports them on each
 * dispute's balance transactions. Additive, defaulted, so every existing row
 * reads 0 until its charge is next re-read. A record; nothing moves here.
 */
export class Migration20261007CardChargeStateDisputeFee extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      ALTER TABLE "hawala_card_charge_state"
      ADD COLUMN IF NOT EXISTS "dispute_fee_cents" INTEGER NOT NULL DEFAULT 0;
    `)
    this.addSql(`
      ALTER TABLE "hawala_card_charge_state"
      DROP CONSTRAINT IF EXISTS "hawala_card_charge_state_dispute_fee_check";
    `)
    this.addSql(`
      ALTER TABLE "hawala_card_charge_state"
      ADD CONSTRAINT "hawala_card_charge_state_dispute_fee_check" CHECK ("dispute_fee_cents" >= 0);
    `)
  }

  async down(): Promise<void> {
    this.addSql(`
      ALTER TABLE "hawala_card_charge_state"
      DROP CONSTRAINT IF EXISTS "hawala_card_charge_state_dispute_fee_check";
    `)
    this.addSql(`ALTER TABLE "hawala_card_charge_state" DROP COLUMN IF EXISTS "dispute_fee_cents";`)
  }
}
