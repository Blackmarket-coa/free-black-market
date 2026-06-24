import { Migration } from "@mikro-orm/migrations"

/**
 * Peer attestation: weight high-trust XP by verified value.
 *  - Creates the `xp_attestation` append-only ledger linking a subject to the
 *    trusted attester who vouched for a contribution.
 */
export class Migration20260624AddXpAttestation extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "xp_attestation" (
        "id" TEXT NOT NULL,
        "subject_customer_id" TEXT NOT NULL,
        "attester_customer_id" TEXT NOT NULL,
        "source_module" TEXT NULL,
        "source_id" TEXT NULL,
        "weight" REAL NOT NULL,
        "reason" TEXT NOT NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "xp_attestation_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_xp_attestation_subject" ON "xp_attestation" ("subject_customer_id") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_xp_attestation_attester" ON "xp_attestation" ("attester_customer_id") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_xp_attestation_source" ON "xp_attestation" ("source_module","source_id") WHERE "deleted_at" IS NULL;`)
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS "xp_attestation";`)
  }
}
