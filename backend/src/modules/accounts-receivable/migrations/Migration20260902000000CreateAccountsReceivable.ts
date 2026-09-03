import { Migration } from "@mikro-orm/migrations"

/**
 * Create the accounts-receivable tables: a vendor's invoices to their buyers,
 * and the payments recorded against them.
 *
 * Additive. The invoices this replaces lived as a JSON blob under
 * `seller_metadata.invoices_v1`; that blob is left in place and backfilled by
 * `scripts/backfill-ar-invoices.ts` rather than dropped here, so a failed
 * migration never destroys a vendor's billing history.
 *
 * Enum-ish columns are TEXT + CHECK rather than Postgres enums, matching
 * `Migration20260806CreateVendorCharge` and for the same reason: adding a
 * value to a real enum cannot be done in the batch that uses it, so a CHECK
 * keeps future statuses to a single ordinary migration.
 *
 * The two load-bearing indexes:
 *
 * - `UQ_ar_invoice_seller_number` — invoice numbers are per-seller, so two
 *   vendors both having an INV-00001 is correct and a global sequence would
 *   leak the platform's order count through every vendor's paperwork.
 * - `UQ_ar_payment_idempotency` — what makes a retried webhook or a
 *   double-clicked "mark paid" collide instead of crediting a buyer twice.
 */
export class Migration20260902000000CreateAccountsReceivable extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "ar_invoice" (
        "id" TEXT NOT NULL,
        "seller_id" TEXT NOT NULL,
        "customer_id" TEXT NULL,
        "order_id" TEXT NULL,
        "invoice_number" TEXT NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'draft',
        "currency_code" TEXT NOT NULL DEFAULT 'usd',
        "total" INTEGER NOT NULL DEFAULT 0,
        "amount_paid" INTEGER NOT NULL DEFAULT 0,
        "terms_days" INTEGER NOT NULL DEFAULT 0,
        "tier_id" TEXT NULL,
        "issued_at" TIMESTAMPTZ NULL,
        "due_at" TIMESTAMPTZ NULL,
        "paid_at" TIMESTAMPTZ NULL,
        "last_dunning_stage" INTEGER NULL,
        "memo" TEXT NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "PK_ar_invoice" PRIMARY KEY ("id"),
        CONSTRAINT "CK_ar_invoice_status" CHECK (
          "status" IN ('draft', 'issued', 'paid', 'void', 'written_off')
        ),
        CONSTRAINT "CK_ar_invoice_total" CHECK ("total" >= 0),
        CONSTRAINT "CK_ar_invoice_paid" CHECK (
          "amount_paid" >= 0 AND "amount_paid" <= "total"
        ),
        CONSTRAINT "CK_ar_invoice_terms" CHECK (
          "terms_days" >= 0 AND "terms_days" <= 180
        ),
        -- An issued invoice always has both timestamps; a draft has neither.
        -- Without this a due date could go missing on the one status where
        -- aging and dunning depend on it.
        CONSTRAINT "CK_ar_invoice_issued_dates" CHECK (
          "status" = 'draft'
          OR ("issued_at" IS NOT NULL AND "due_at" IS NOT NULL)
        )
      );
    `)

    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_ar_invoice_seller_number"
        ON "ar_invoice" ("seller_id", "invoice_number") WHERE "deleted_at" IS NULL;
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_ar_invoice_seller_status"
        ON "ar_invoice" ("seller_id", "status") WHERE "deleted_at" IS NULL;
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_ar_invoice_customer"
        ON "ar_invoice" ("customer_id") WHERE "deleted_at" IS NULL;
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_ar_invoice_due_at"
        ON "ar_invoice" ("due_at") WHERE "deleted_at" IS NULL;
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_ar_invoice_order"
        ON "ar_invoice" ("order_id") WHERE "deleted_at" IS NULL;
    `)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "ar_invoice_payment" (
        "id" TEXT NOT NULL,
        "invoice_id" TEXT NOT NULL,
        "seller_id" TEXT NOT NULL,
        "amount" INTEGER NOT NULL,
        "currency_code" TEXT NOT NULL DEFAULT 'usd',
        "method" TEXT NULL,
        "reference" TEXT NULL,
        "received_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "idempotency_key" TEXT NOT NULL,
        "note" TEXT NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "PK_ar_invoice_payment" PRIMARY KEY ("id"),
        CONSTRAINT "CK_ar_payment_amount" CHECK ("amount" > 0)
      );
    `)

    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_ar_payment_idempotency"
        ON "ar_invoice_payment" ("idempotency_key") WHERE "deleted_at" IS NULL;
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_ar_payment_invoice"
        ON "ar_invoice_payment" ("invoice_id") WHERE "deleted_at" IS NULL;
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_ar_payment_seller"
        ON "ar_invoice_payment" ("seller_id") WHERE "deleted_at" IS NULL;
    `)
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS "ar_invoice_payment" CASCADE;`)
    this.addSql(`DROP TABLE IF EXISTS "ar_invoice" CASCADE;`)
  }
}
