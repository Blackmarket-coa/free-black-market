import { Migration } from "@mikro-orm/migrations"

/**
 * Create the order dispute tables.
 *
 * Additive. The escrow state machine has modelled arbitration since it was
 * written, but only service contracts and subcontracts could reach it; a
 * buyer with a bad ordinary order had no route at all. These tables are the
 * case file and the queue.
 *
 * The load-bearing constraint is `UQ_order_dispute_live`: a partial unique
 * index allowing at most ONE open or under-review dispute per order. A second
 * live claim is the same argument, and two running at once could be resolved
 * in opposite directions by two admins. Resolved and withdrawn disputes fall
 * out of the index, so an order can legitimately be disputed again later.
 */
export class Migration20260902000300CreateOrderDispute extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "order_dispute" (
        "id" TEXT NOT NULL,
        "order_id" TEXT NOT NULL,
        "seller_id" TEXT NOT NULL,
        "customer_id" TEXT NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'open',
        "reason" TEXT NOT NULL DEFAULT 'other',
        "description" TEXT NOT NULL,
        "currency_code" TEXT NOT NULL DEFAULT 'usd',
        "claim_amount" INTEGER NOT NULL DEFAULT 0,
        "award_amount" INTEGER NOT NULL DEFAULT 0,
        "seller_response" TEXT NULL,
        "seller_responded_at" TIMESTAMPTZ NULL,
        "resolution_note" TEXT NULL,
        "resolved_at" TIMESTAMPTZ NULL,
        "resolved_by" TEXT NULL,
        "escrow_agreement_id" TEXT NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "PK_order_dispute" PRIMARY KEY ("id"),
        CONSTRAINT "CK_order_dispute_status" CHECK (
          "status" IN ('open', 'under_review', 'resolved_refund', 'resolved_release', 'withdrawn')
        ),
        CONSTRAINT "CK_order_dispute_reason" CHECK (
          "reason" IN ('not_received', 'not_as_described', 'damaged', 'incomplete', 'billing', 'other')
        ),
        CONSTRAINT "CK_order_dispute_claim" CHECK ("claim_amount" >= 0),
        -- An award can never exceed what was claimed, and a release awards
        -- nothing. Enforced here as well as in resolution.ts because this is
        -- the number that becomes a refund.
        CONSTRAINT "CK_order_dispute_award" CHECK (
          "award_amount" >= 0 AND "award_amount" <= "claim_amount"
        ),
        CONSTRAINT "CK_order_dispute_release_award" CHECK (
          "status" <> 'resolved_release' OR "award_amount" = 0
        ),
        CONSTRAINT "CK_order_dispute_resolved" CHECK (
          "status" NOT IN ('resolved_refund', 'resolved_release')
          OR ("resolved_at" IS NOT NULL AND "resolved_by" IS NOT NULL)
        )
      );
    `)

    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_order_dispute_live"
        ON "order_dispute" ("order_id")
        WHERE "deleted_at" IS NULL AND "status" IN ('open', 'under_review');
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_order_dispute_seller_status"
        ON "order_dispute" ("seller_id", "status") WHERE "deleted_at" IS NULL;
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_order_dispute_customer"
        ON "order_dispute" ("customer_id") WHERE "deleted_at" IS NULL;
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_order_dispute_status"
        ON "order_dispute" ("status") WHERE "deleted_at" IS NULL;
    `)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "order_dispute_event" (
        "id" TEXT NOT NULL,
        "dispute_id" TEXT NOT NULL,
        "kind" TEXT NOT NULL,
        "actor_type" TEXT NOT NULL,
        "actor_id" TEXT NULL,
        "from_status" TEXT NULL,
        "to_status" TEXT NULL,
        "message" TEXT NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "PK_order_dispute_event" PRIMARY KEY ("id"),
        CONSTRAINT "FK_order_dispute_event_dispute" FOREIGN KEY ("dispute_id")
          REFERENCES "order_dispute" ("id") ON DELETE CASCADE,
        CONSTRAINT "CK_order_dispute_event_actor" CHECK (
          "actor_type" IN ('buyer', 'seller', 'admin', 'system')
        )
      );
    `)

    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_order_dispute_event_dispute"
        ON "order_dispute_event" ("dispute_id") WHERE "deleted_at" IS NULL;
    `)
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS "order_dispute_event" CASCADE;`)
    this.addSql(`DROP TABLE IF EXISTS "order_dispute" CASCADE;`)
  }
}
