import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Migration: add `hawala_escrow_agreement` and `hawala_patronage_allocation`.
 *
 * Both tables land as part of the FBM composition-layer foundation:
 *
 * - `hawala_escrow_agreement` records Stellar 2-of-3 multisig escrow
 *   agreements with pre-authorized time-locked recovery. Polymorphic
 *   `(subject_type, subject_id)` linkage with a CHECK constraint to keep
 *   subject types tight without circular FK dependencies.
 *
 * - `hawala_patronage_allocation` records one row per (period, seller)
 *   for the quarterly patronage refund pool. Settled by the
 *   patronage-refund scheduled job as a single atomic Stellar tx.
 *
 * See `docs/POSTURE_A_COMPLIANCE.md`, `docs/COMPOSITION_LAYER.md`.
 */
export class Migration20260510AddEscrowAndPatronage extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "hawala_escrow_agreement" (
        "id" TEXT NOT NULL,
        "state" TEXT NOT NULL DEFAULT 'pending',
        "subject_type" TEXT NOT NULL,
        "subject_id" TEXT NOT NULL,
        "stellar_account_id" TEXT NOT NULL,
        "signers_json" JSONB NOT NULL,
        "threshold" INTEGER NOT NULL DEFAULT 2,
        "recovery_unlock_at" TIMESTAMPTZ NULL,
        "recovery_signer_pubkey" TEXT NULL,
        "amount" REAL NOT NULL,
        "currency_code" TEXT NOT NULL,
        "released_at" TIMESTAMPTZ NULL,
        "recovered_at" TIMESTAMPTZ NULL,
        "dispute_id" TEXT NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "hawala_escrow_agreement_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "hawala_escrow_subject_type_chk" CHECK (
          "subject_type" IN ('order', 'bounty', 'campaign', 'service_engagement')
        ),
        CONSTRAINT "hawala_escrow_state_chk" CHECK (
          "state" IN ('pending', 'funded', 'released', 'disputed', 'recovered')
        )
      );
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_escrow_subject" ON "hawala_escrow_agreement" ("subject_type", "subject_id") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_escrow_state" ON "hawala_escrow_agreement" ("state") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_escrow_stellar_account_id" ON "hawala_escrow_agreement" ("stellar_account_id") WHERE "deleted_at" IS NULL;`)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "hawala_patronage_allocation" (
        "id" TEXT NOT NULL,
        "seller_id" TEXT NOT NULL,
        "period_start" TIMESTAMPTZ NOT NULL,
        "period_end" TIMESTAMPTZ NOT NULL,
        "period_key" TEXT NOT NULL,
        "gross_volume" REAL NOT NULL,
        "allocation_amount" REAL NOT NULL,
        "allocation_currency" TEXT NOT NULL DEFAULT 'USD',
        "status" TEXT NOT NULL DEFAULT 'computed',
        "stellar_tx_hash" TEXT NULL,
        "paid_at" TIMESTAMPTZ NULL,
        "computed_at" TIMESTAMPTZ NOT NULL,
        "error_message" TEXT NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "hawala_patronage_allocation_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "hawala_patronage_status_chk" CHECK (
          "status" IN ('computed', 'queued', 'paid', 'failed')
        ),
        CONSTRAINT "hawala_patronage_seller_period_key_uniq" UNIQUE ("seller_id", "period_key")
      );
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_patronage_seller_period" ON "hawala_patronage_allocation" ("seller_id", "period_start" DESC) WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_patronage_period_status" ON "hawala_patronage_allocation" ("period_key", "status") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_patronage_status" ON "hawala_patronage_allocation" ("status") WHERE "deleted_at" IS NULL;`)
  }

  override async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS "hawala_patronage_allocation";`)
    this.addSql(`DROP TABLE IF EXISTS "hawala_escrow_agreement";`)
  }
}
