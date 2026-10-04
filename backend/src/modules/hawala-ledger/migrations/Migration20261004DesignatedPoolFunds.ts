import { Migration } from "@mikro-orm/migrations"

/**
 * Designated legacy pool funds (docs/BMC_SURVIVAL_PROGRAMS.md Decision 8;
 * legal checkpoints L26, L3) — Phase 1b slice S15.
 *
 * Decision 8 (operator, 2026-10-04): "Ledger money should be in designated
 * accounts." Read as: ledger dollars already inside an UNCARRIED pool when
 * FF_NONPROFIT_PARITY_V1 turns on stay segregated in that pool's existing
 * PRODUCER_POOL account, which becomes a DESIGNATED account — outbound-only
 * back to the contributors, reported, wound down to zero. No new
 * `account_type`, no new ledger vocabulary: "designated" is a state recorded
 * on the pool. This migration adds the one column that records it:
 *
 *   - `hawala_investment_pool.legacy_funds_designated_at` TIMESTAMPTZ NULL —
 *     when the flag-on guard first let an outbound leg leave the pool's
 *     account. Reporting only; the direction rule reads the account balance.
 *   - a partial index over the stamped pools for the admin report.
 *
 * Depends only on `hawala_investment_pool` itself (created by
 * Migration20251229CreateHawalaLedger), so its position among the 20261004
 * migrations does not matter: no CHECK names an S12/S14 column. No balance
 * column, no `ALTER TYPE`. `down()` drops only this change's two additions.
 */
export class Migration20261004DesignatedPoolFunds extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      ALTER TABLE "hawala_investment_pool"
        ADD COLUMN IF NOT EXISTS "legacy_funds_designated_at" TIMESTAMPTZ NULL;
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_hawala_investment_pool_legacy_funds_designated_at"
      ON "hawala_investment_pool" ("legacy_funds_designated_at")
      WHERE "deleted_at" IS NULL AND "legacy_funds_designated_at" IS NOT NULL;
    `)
  }

  async down(): Promise<void> {
    this.addSql(`DROP INDEX IF EXISTS "IDX_hawala_investment_pool_legacy_funds_designated_at";`)
    this.addSql(`ALTER TABLE "hawala_investment_pool" DROP COLUMN IF EXISTS "legacy_funds_designated_at";`)
  }
}
