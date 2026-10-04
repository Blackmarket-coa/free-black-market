import { Migration } from "@mikro-orm/migrations"

/**
 * Carried-pool contribution lifecycle (docs/BMC_SURVIVAL_PROGRAMS.md Decision
 * 7; legal checkpoint L26) — Phase 1b slice S14. Runs after
 * Migration20261004PoolCarrier (S12), which created the CARRIER settlement.
 *
 * A contribution to a carried pool is now collected THROUGH FBM as a direct
 * charge on the carrier's own connected account and recorded on
 * `hawala_investment` as a PENDING CARRIER row at checkout, CONFIRMED by the
 * Connect webhook when the intent succeeds, CANCELLED when it fails, and —
 * when the processor fully refunds the charge, confirmed or not yet (Stripe
 * does not order events) — CANCELLED with `reversed_at` set.
 * `Investment.status` gains no value; the one addition is the nullable
 * `reversed_at` column, which marks the row terminal (a success delivered
 * before or after cannot confirm a reversed contribution) and dates the
 * reversal. The pool's derived totals count CONFIRMED, unreversed rows only.
 *
 * No balance column, no ledger vocabulary, no `ALTER TYPE`. `down()` drops
 * only this column.
 */
export class Migration20261004PoolContributionReversal extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      ALTER TABLE "hawala_investment"
        ADD COLUMN IF NOT EXISTS "reversed_at" TIMESTAMPTZ NULL;
    `)
    // A reversal is a fact about a CARRIER record only: a LEDGER row's refund
    // is a ledger leg (processRefund), never this column.
    this.addSql(`
      DO $$ BEGIN
        ALTER TABLE "hawala_investment"
        ADD CONSTRAINT "hawala_investment_reversed_carrier_only_check"
          CHECK ("reversed_at" IS NULL OR "settlement" = 'CARRIER');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)
  }

  async down(): Promise<void> {
    this.addSql(`ALTER TABLE "hawala_investment" DROP CONSTRAINT IF EXISTS "hawala_investment_reversed_carrier_only_check";`)
    this.addSql(`ALTER TABLE "hawala_investment" DROP COLUMN IF EXISTS "reversed_at";`)
  }
}
