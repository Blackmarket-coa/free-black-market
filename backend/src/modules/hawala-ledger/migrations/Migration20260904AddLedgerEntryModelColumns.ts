import { Migration } from "@mikro-orm/migrations"

/**
 * `hawala_ledger_entry` declares five columns its migrations never created:
 * `currency_code`, `settlement_batch_id`, `settled_at`, and the two
 * `model.bigNumber()` balance snapshots `debit_balance_after` /
 * `credit_balance_after` (each of which also needs its `raw_*` JSONB
 * companion). The `currency_code` the create migration does define belongs to
 * `hawala_settlement_batch`, not the entry table.
 *
 * Because `currency_code` carries a model default, MikroORM includes it in
 * every insert, so on a database built from its own migrations the generated
 * CRUD could not write a single ledger entry. No existing test saw it: the
 * http specs never create an entry and the module runners generate their
 * schema from the model rather than the migrations.
 *
 * Column adds only, every one `IF NOT EXISTS`, so this is a no-op on a
 * database that already carries them (from `db:generate` or by hand) and safe
 * on one that has rows.
 */
export class Migration20260904AddLedgerEntryModelColumns extends Migration {
  async up(): Promise<void> {
    this.addSql(`ALTER TABLE "hawala_ledger_entry" ADD COLUMN IF NOT EXISTS "currency_code" TEXT NOT NULL DEFAULT 'USD';`)
    this.addSql(`ALTER TABLE "hawala_ledger_entry" ADD COLUMN IF NOT EXISTS "settlement_batch_id" TEXT NULL;`)
    this.addSql(`ALTER TABLE "hawala_ledger_entry" ADD COLUMN IF NOT EXISTS "settled_at" TIMESTAMPTZ NULL;`)
    this.addSql(`ALTER TABLE "hawala_ledger_entry" ADD COLUMN IF NOT EXISTS "debit_balance_after" NUMERIC NULL;`)
    this.addSql(`ALTER TABLE "hawala_ledger_entry" ADD COLUMN IF NOT EXISTS "raw_debit_balance_after" JSONB NULL;`)
    this.addSql(`ALTER TABLE "hawala_ledger_entry" ADD COLUMN IF NOT EXISTS "credit_balance_after" NUMERIC NULL;`)
    this.addSql(`ALTER TABLE "hawala_ledger_entry" ADD COLUMN IF NOT EXISTS "raw_credit_balance_after" JSONB NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_hawala_ledger_entry_settlement_batch" ON "hawala_ledger_entry" ("settlement_batch_id") WHERE "deleted_at" IS NULL;`)
  }

  async down(): Promise<void> {
    this.addSql(`DROP INDEX IF EXISTS "IDX_hawala_ledger_entry_settlement_batch";`)
    for (const col of [
      "raw_credit_balance_after",
      "credit_balance_after",
      "raw_debit_balance_after",
      "debit_balance_after",
      "settled_at",
      "settlement_batch_id",
      "currency_code",
    ]) {
      this.addSql(`ALTER TABLE "hawala_ledger_entry" DROP COLUMN IF EXISTS "${col}";`)
    }
  }
}
