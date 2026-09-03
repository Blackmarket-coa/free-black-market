import { Migration } from "@mikro-orm/migrations"

/**
 * Create the inbound Blackstar event receipt table.
 *
 * Closes open contract item §9.4 in
 * `docs/integrations/federated-logistics.md` — the FBM-side counterpart to
 * Blackstar's `fbm_inbound_event_receipts`. It only became possible when
 * §9.2 closed and the outbound envelope started carrying an `event_id` that
 * is stable across retries, so the column finally identifies an event rather
 * than a delivery attempt.
 *
 * `UQ_blackstar_event_receipt_event` is the whole point: it is what makes a
 * redelivery a no-op. It also settles the race between two concurrent
 * deliveries of the same event — one insert wins, the loser catches the
 * violation and returns the same answer.
 *
 * Additive; nothing existing is touched.
 */
export class Migration20260902000400CreateBlackstarEventReceipt extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "blackstar_event_receipt" (
        "id" TEXT NOT NULL,
        "event_id" TEXT NOT NULL,
        "event_type" TEXT NOT NULL,
        "source_order_ref" TEXT NULL,
        "correlation_id" TEXT NULL,
        "outcome" TEXT NOT NULL,
        "requested_status" TEXT NULL,
        "resulting_status" TEXT NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "PK_blackstar_event_receipt" PRIMARY KEY ("id"),
        CONSTRAINT "CK_blackstar_event_receipt_outcome" CHECK (
          "outcome" IN (
            'applied', 'first_status', 'same_status',
            'out_of_order', 'terminal', 'unknown_status', 'ignored'
          )
        )
      );
    `)

    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_blackstar_event_receipt_event"
        ON "blackstar_event_receipt" ("event_id") WHERE "deleted_at" IS NULL;
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_blackstar_event_receipt_order"
        ON "blackstar_event_receipt" ("source_order_ref") WHERE "deleted_at" IS NULL;
    `)
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS "blackstar_event_receipt" CASCADE;`)
  }
}
