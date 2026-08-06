import { Migration } from "@mikro-orm/migrations"

/**
 * Phase 4 — what happens to a pledge when a pool does not complete.
 *
 * Additive and behaviour-preserving. The column defaults to 'REFUND', which is
 * exactly what the code did before this existed, so every current and
 * historical participant keeps a plain refund unless they later choose
 * otherwise. That default is the guardrail: a redirect to mutual aid must be
 * explicit and opt-in, never inherited and never inferred.
 *
 * TEXT + CHECK rather than a Postgres enum, deliberately. `bounty_status_enum`
 * is a real enum and that has already cost a harness workaround in
 * `milestone-cas.integration.spec.ts`, because Medusa's `model.enum()`
 * generates TEXT + CHECK while the migration generated a native type. Matching
 * what the model generates keeps the two in step.
 */
export class Migration20260805AddSurplusDisposition extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      ALTER TABLE "demand_participant"
        ADD COLUMN IF NOT EXISTS "surplus_disposition" TEXT NOT NULL DEFAULT 'REFUND';
    `)
    this.addSql(`
      ALTER TABLE "demand_participant"
        DROP CONSTRAINT IF EXISTS "demand_participant_surplus_disposition_check";
    `)
    this.addSql(`
      ALTER TABLE "demand_participant"
        ADD CONSTRAINT "demand_participant_surplus_disposition_check"
        CHECK ("surplus_disposition" IN ('REFUND', 'DONATE'));
    `)
    // The read this exists for: "which pledges in this pool were opted in to
    // redirect" — a small minority of rows, so a partial index.
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_participant_surplus_donate"
        ON "demand_participant" ("demand_post_id")
        WHERE "surplus_disposition" = 'DONATE' AND "deleted_at" IS NULL;
    `)
  }

  async down(): Promise<void> {
    this.addSql('DROP INDEX IF EXISTS "IDX_participant_surplus_donate";')
    this.addSql(`
      ALTER TABLE "demand_participant"
        DROP CONSTRAINT IF EXISTS "demand_participant_surplus_disposition_check";
    `)
    this.addSql(`
      ALTER TABLE "demand_participant"
        DROP COLUMN IF EXISTS "surplus_disposition";
    `)
  }
}
