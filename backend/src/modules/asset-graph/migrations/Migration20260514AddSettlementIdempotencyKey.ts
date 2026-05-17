import { Migration } from "@mikro-orm/migrations"

/**
 * Migration: add `idempotency_key` to `settlement_record`.
 *
 * Caller-supplied dedup key for systematic emitters. When set, the
 * asset-graph service's emitSettlementRecord path returns an
 * existing record with the same key instead of writing a duplicate.
 *
 * Convention: `${manifest_slug}-${source_event_id}` — e.g.
 * "tool-library-loan_42-return" so two emits for the same loan
 * return event yield the same SettlementRecord.
 *
 * Nullable, partial-unique (only enforced when not null) so legacy
 * rows and ad-hoc emits can leave it empty without violating the
 * constraint.
 */
export class Migration20260514AddSettlementIdempotencyKey extends Migration {
  async up(): Promise<void> {
    this.addSql(
      `ALTER TABLE "settlement_record" ADD COLUMN IF NOT EXISTS "idempotency_key" TEXT NULL;`
    )
    this.addSql(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_settlement_record_idempotency_key" ` +
        `ON "settlement_record" ("idempotency_key") ` +
        `WHERE "idempotency_key" IS NOT NULL AND "deleted_at" IS NULL;`
    )
  }

  async down(): Promise<void> {
    this.addSql(
      `DROP INDEX IF EXISTS "UQ_settlement_record_idempotency_key";`
    )
    this.addSql(
      `ALTER TABLE "settlement_record" DROP COLUMN IF EXISTS "idempotency_key";`
    )
  }
}
