import { Migration } from "@mikro-orm/migrations"

/**
 * donation_split_record — record-only ledger for direct-charge donations
 * (docs/POSTURE_A_COMPLIANCE.md rule 10; docs/BMC_SURVIVAL_PROGRAMS.md Phase 1).
 *
 * Shape follows partner-directory's Migration20261003CreatePartnerOrg:
 * idempotent, soft-delete columns, partial unique index `WHERE deleted_at IS
 * NULL`, TEXT + CHECK for the vocabularies, full `down()`.
 *
 * The CHECKs are the posture written into the schema:
 *   - `bmc_fee_cents = 0` — the row cannot record BMC taking a cut of a
 *     donation, whatever code writes it.
 *   - `gross_cents > 0` — a record is of money the donor actually paid.
 *   - `refunded_cents` within `[0, gross_cents]` when present — what the
 *     processor refunded, never more than it collected.
 * Integer cents throughout; there is no balance column to drift.
 */
export class Migration20261003CreateDonationSplitRecord extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "donation_split_record" (
        "id" TEXT NOT NULL,
        "stripe_payment_intent_id" TEXT NOT NULL,
        "stripe_account_id" TEXT NOT NULL,
        "org_key" TEXT NOT NULL,
        "campaign_id" TEXT NULL,
        "kind" TEXT NOT NULL DEFAULT 'donation',
        "currency_code" TEXT NOT NULL DEFAULT 'usd',
        "gross_cents" INTEGER NOT NULL,
        "bmc_fee_cents" INTEGER NOT NULL DEFAULT 0,
        "processor_fee_cents" INTEGER NULL,
        "refunded_cents" INTEGER NULL,
        "recipient_org_type" TEXT NULL,
        "recipient_verification_status" TEXT NOT NULL,
        "recipient_verified_as_of" TIMESTAMPTZ NULL,
        "recipient_snapshot_at" TIMESTAMPTZ NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'created',
        "customer_id" TEXT NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "donation_split_record_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "donation_split_record_kind_check"
          CHECK ("kind" IN ('donation','donation_pledge')),
        CONSTRAINT "donation_split_record_status_check"
          CHECK ("status" IN ('created','succeeded','refunded','failed')),
        CONSTRAINT "donation_split_record_bmc_fee_zero_check"
          CHECK ("bmc_fee_cents" = 0),
        CONSTRAINT "donation_split_record_gross_positive_check"
          CHECK ("gross_cents" > 0),
        CONSTRAINT "donation_split_record_refunded_bounded_check"
          CHECK ("refunded_cents" IS NULL OR ("refunded_cents" >= 0 AND "refunded_cents" <= "gross_cents"))
      );
    `)
    this.addSql(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_donation_split_record_intent_unique" ON "donation_split_record" ("stripe_payment_intent_id") WHERE "deleted_at" IS NULL;`
    )
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_donation_split_record_org_key" ON "donation_split_record" ("org_key") WHERE "deleted_at" IS NULL;`
    )
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_donation_split_record_status" ON "donation_split_record" ("status") WHERE "deleted_at" IS NULL;`
    )
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_donation_split_record_customer_id" ON "donation_split_record" ("customer_id") WHERE "deleted_at" IS NULL;`
    )
  }

  async down(): Promise<void> {
    this.addSql(`DROP INDEX IF EXISTS "IDX_donation_split_record_customer_id";`)
    this.addSql(`DROP INDEX IF EXISTS "IDX_donation_split_record_status";`)
    this.addSql(`DROP INDEX IF EXISTS "IDX_donation_split_record_org_key";`)
    this.addSql(`DROP INDEX IF EXISTS "IDX_donation_split_record_intent_unique";`)
    this.addSql(`DROP TABLE IF EXISTS "donation_split_record" CASCADE;`)
  }
}
