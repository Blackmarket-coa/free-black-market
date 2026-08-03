import { Migration } from "@mikro-orm/migrations"

/**
 * Create the platform → vendor charge table.
 *
 * Additive; nothing existing is touched. This is the first table in the
 * codebase that represents the platform billing a vendor —
 * `api/vendor/invoices` is the opposite direction (a vendor invoicing their own
 * customers) and is unrelated.
 *
 * Enum-ish columns are TEXT + CHECK rather than Postgres enums, matching
 * `Migration20260805CreateVendorPlan` and for the same reason: adding a value
 * to a real enum cannot be done in the same migration batch that uses it (see
 * `Migration20260802AddGeneralVendorType`), so a CHECK keeps future kinds and
 * statuses to a single ordinary migration.
 *
 * The partial-unique index on `idempotency_key` is the load-bearing one: it is
 * what makes a replayed Stripe webhook or a re-fired renewal cron collide
 * instead of debiting a vendor twice. `WHERE deleted_at IS NULL` so a
 * soft-deleted charge does not permanently reserve its key.
 */
export class Migration20260806CreateVendorCharge extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "vendor_charge" (
        "id" TEXT NOT NULL,
        "seller_id" TEXT NOT NULL,
        "kind" TEXT NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'pending',
        "amount" INTEGER NOT NULL,
        "currency_code" TEXT NOT NULL DEFAULT 'usd',
        "description" TEXT NOT NULL,
        "idempotency_key" TEXT NOT NULL,
        "period_start" TIMESTAMPTZ NULL,
        "period_end" TIMESTAMPTZ NULL,
        "stripe_payment_intent_id" TEXT NULL,
        "failure_reason" TEXT NULL,
        "paid_at" TIMESTAMPTZ NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "PK_vendor_charge" PRIMARY KEY ("id"),
        CONSTRAINT "CK_vendor_charge_kind" CHECK (
          "kind" IN ('plan', 'promotion', 'usage', 'manual')
        ),
        CONSTRAINT "CK_vendor_charge_status" CHECK (
          "status" IN ('pending', 'processing', 'paid', 'failed', 'void', 'refunded')
        ),
        CONSTRAINT "CK_vendor_charge_amount" CHECK ("amount" >= 0)
      );
    `)

    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_vendor_charge_idempotency"
        ON "vendor_charge" ("idempotency_key") WHERE "deleted_at" IS NULL;
    `)

    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_vendor_charge_seller_status"
        ON "vendor_charge" ("seller_id", "status") WHERE "deleted_at" IS NULL;
    `)

    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_vendor_charge_payment_intent"
        ON "vendor_charge" ("stripe_payment_intent_id") WHERE "deleted_at" IS NULL;
    `)
  }

  async down(): Promise<void> {
    this.addSql(`DROP INDEX IF EXISTS "IDX_vendor_charge_payment_intent";`)
    this.addSql(`DROP INDEX IF EXISTS "IDX_vendor_charge_seller_status";`)
    this.addSql(`DROP INDEX IF EXISTS "IDX_vendor_charge_idempotency";`)
    this.addSql(`DROP TABLE IF EXISTS "vendor_charge";`)
  }
}
