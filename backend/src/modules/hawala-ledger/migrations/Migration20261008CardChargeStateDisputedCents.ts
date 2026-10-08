import { Migration } from "@mikro-orm/migrations"

/**
 * `hawala_card_charge_state.disputed_cents` (SD-44): the amount every dispute
 * on the charge covered, whatever its outcome. On a charge that paid several
 * orders (a Mercur cart), Stripe's dispute fee is put on those orders only
 * when the disputes covered the whole charge — a partial dispute does not say
 * which order was disputed (operator answer 2026-10-07: the vendor whose
 * order was disputed owes it). A separate migration, because
 * `Migration20261007CardChargeStateDisputeFee` had already merged; named to
 * sort after it. Additive, defaulted, so every existing row reads 0 until its
 * charge is next re-read — and a shared cart's fee is then put on no seller,
 * the safe direction. A record; nothing moves here.
 */
export class Migration20261008CardChargeStateDisputedCents extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      ALTER TABLE "hawala_card_charge_state"
      ADD COLUMN IF NOT EXISTS "disputed_cents" INTEGER NOT NULL DEFAULT 0;
    `)
    this.addSql(`
      ALTER TABLE "hawala_card_charge_state"
      DROP CONSTRAINT IF EXISTS "hawala_card_charge_state_disputed_check";
    `)
    this.addSql(`
      ALTER TABLE "hawala_card_charge_state"
      ADD CONSTRAINT "hawala_card_charge_state_disputed_check" CHECK ("disputed_cents" >= 0);
    `)
  }

  async down(): Promise<void> {
    this.addSql(`
      ALTER TABLE "hawala_card_charge_state"
      DROP CONSTRAINT IF EXISTS "hawala_card_charge_state_disputed_check";
    `)
    this.addSql(`ALTER TABLE "hawala_card_charge_state" DROP COLUMN IF EXISTS "disputed_cents";`)
  }
}
