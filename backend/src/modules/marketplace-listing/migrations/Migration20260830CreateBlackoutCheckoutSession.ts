import { Migration } from "@mikro-orm/migrations"

/**
 * Stateful Blackout checkout sessions (W1b).
 *
 * Backing table for `/v1/integrations/blackout/commerce/checkout/sessions`:
 * the partial unique index on (blackout_user_id, listing_id, idempotency_key)
 * is what turns the previously decorative `idempotency-key` header into a
 * guarantee — a retried POST re-reads this row instead of minting a second
 * cart/order/charge.
 */
export class Migration20260830CreateBlackoutCheckoutSession extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      DO $$ BEGIN
        CREATE TYPE "blackout_checkout_session_status_enum" AS ENUM (
          'pending', 'completed', 'failed'
        );
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "blackout_checkout_session" (
        "id" TEXT NOT NULL,
        "blackout_user_id" TEXT NOT NULL,
        "listing_id" TEXT NOT NULL,
        "idempotency_key" TEXT NULL,
        "mxid" TEXT NULL,
        "customer_id" TEXT NULL,
        "cart_id" TEXT NULL,
        "order_id" TEXT NULL,
        "subscription_id" TEXT NULL,
        "status" blackout_checkout_session_status_enum NOT NULL DEFAULT 'pending',
        "embed" BOOLEAN NOT NULL DEFAULT false,
        "embed_origin" TEXT NULL,
        "return_url" TEXT NULL,
        "requested_metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "blackout_checkout_session_pkey" PRIMARY KEY ("id")
      );
    `)

    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_blackout_checkout_session_idem"
        ON "blackout_checkout_session" ("blackout_user_id", "listing_id", "idempotency_key")
        WHERE "idempotency_key" IS NOT NULL AND "deleted_at" IS NULL;
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_blackout_checkout_session_cart_id"
        ON "blackout_checkout_session" ("cart_id");
    `)
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS "blackout_checkout_session";`)
    this.addSql(`DROP TYPE IF EXISTS "blackout_checkout_session_status_enum";`)
  }
}
