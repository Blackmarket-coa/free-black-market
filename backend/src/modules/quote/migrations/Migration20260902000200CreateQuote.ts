import { Migration } from "@mikro-orm/migrations"

/**
 * Create the quote tables: a vendor's priced offer to a buyer, and its lines.
 *
 * Additive. This is the hop that did not exist — `request` captured an ask and
 * `bargaining` priced a group proposal, but nothing turned either into
 * line-item prices against a vendor's ordinary listings that a buyer could
 * accept into a cart.
 *
 * Enum-ish columns are TEXT + CHECK rather than Postgres enums, matching
 * `Migration20260806CreateVendorCharge`: adding a value to a real enum cannot
 * be done in the batch that uses it.
 *
 * The CHECKs are the load-bearing part. Quantity and unit price are integers
 * and non-negative at the database, not only in `pricing.ts`, because a
 * fractional cent that reaches a quote line would make the cart the buyer
 * accepts disagree with the quote they agreed to — and the disagreement would
 * surface at checkout, in front of the customer.
 */
export class Migration20260902000200CreateQuote extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "quote" (
        "id" TEXT NOT NULL,
        "seller_id" TEXT NOT NULL,
        "customer_id" TEXT NOT NULL,
        "request_id" TEXT NULL,
        "quote_number" TEXT NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'draft',
        "currency_code" TEXT NOT NULL DEFAULT 'usd',
        "subtotal" INTEGER NOT NULL DEFAULT 0,
        "list_subtotal" INTEGER NOT NULL DEFAULT 0,
        "sent_at" TIMESTAMPTZ NULL,
        "valid_until" TIMESTAMPTZ NULL,
        "accepted_at" TIMESTAMPTZ NULL,
        "cart_id" TEXT NULL,
        "order_id" TEXT NULL,
        "resolution_note" TEXT NULL,
        "notes" TEXT NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "PK_quote" PRIMARY KEY ("id"),
        CONSTRAINT "CK_quote_status" CHECK (
          "status" IN ('draft', 'sent', 'accepted', 'declined', 'withdrawn', 'expired')
        ),
        CONSTRAINT "CK_quote_subtotal" CHECK ("subtotal" >= 0),
        CONSTRAINT "CK_quote_list_subtotal" CHECK ("list_subtotal" >= 0),
        -- A sent quote always has both timestamps. Without this a quote could
        -- be live with no deadline, which is an open-ended price promise.
        CONSTRAINT "CK_quote_sent_dates" CHECK (
          "status" = 'draft'
          OR ("sent_at" IS NOT NULL AND "valid_until" IS NOT NULL)
        ),
        -- An accepted quote always names the cart built at its prices.
        CONSTRAINT "CK_quote_accepted_cart" CHECK (
          "status" <> 'accepted'
          OR ("accepted_at" IS NOT NULL AND "cart_id" IS NOT NULL)
        )
      );
    `)

    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_quote_seller_number"
        ON "quote" ("seller_id", "quote_number") WHERE "deleted_at" IS NULL;
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_quote_seller_status"
        ON "quote" ("seller_id", "status") WHERE "deleted_at" IS NULL;
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_quote_customer_status"
        ON "quote" ("customer_id", "status") WHERE "deleted_at" IS NULL;
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_quote_request"
        ON "quote" ("request_id") WHERE "deleted_at" IS NULL;
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_quote_valid_until"
        ON "quote" ("valid_until") WHERE "deleted_at" IS NULL;
    `)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "quote_line" (
        "id" TEXT NOT NULL,
        "quote_id" TEXT NOT NULL,
        "variant_id" TEXT NOT NULL,
        "title" TEXT NULL,
        "quantity" INTEGER NOT NULL,
        "unit_price" INTEGER NOT NULL,
        "list_unit_price" INTEGER NULL,
        "note" TEXT NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "PK_quote_line" PRIMARY KEY ("id"),
        CONSTRAINT "FK_quote_line_quote" FOREIGN KEY ("quote_id")
          REFERENCES "quote" ("id") ON DELETE CASCADE,
        CONSTRAINT "CK_quote_line_quantity" CHECK ("quantity" > 0),
        CONSTRAINT "CK_quote_line_unit_price" CHECK ("unit_price" >= 0),
        CONSTRAINT "CK_quote_line_list_price" CHECK (
          "list_unit_price" IS NULL OR "list_unit_price" >= 0
        )
      );
    `)

    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_quote_line_quote"
        ON "quote_line" ("quote_id") WHERE "deleted_at" IS NULL;
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_quote_line_variant"
        ON "quote_line" ("variant_id") WHERE "deleted_at" IS NULL;
    `)
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS "quote_line" CASCADE;`)
    this.addSql(`DROP TABLE IF EXISTS "quote" CASCADE;`)
  }
}
