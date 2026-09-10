import { Migration } from "@mikro-orm/migrations"

/**
 * `order_cycle_sale` — the ledger that makes `recordSale` idempotent.
 *
 * `order_cycle_product.sold_quantity` is a bare counter incremented with
 * `sold_quantity + quantity`, so a retried or duplicated `order.placed`
 * double-counted it and nothing recorded that the sale had already been
 * applied. D9-2 in docs/AUDIT_DEBT.md.
 *
 * The partial unique index is the guarantee. A read-then-write check in the
 * service is the fast path only — two concurrent deliveries of the same event
 * would both pass it — so uniqueness has to live in the database. It is
 * partial on `source_id IS NOT NULL` because a manual adjustment carries no
 * source id and several of those are legitimate: two identical manual
 * corrections are two corrections.
 *
 * Additive: a new table only, no change to `order_cycle_product`, so existing
 * `sold_quantity` values are untouched and nothing needs backfilling. Sales
 * placed before this migration have no row here, which means a duplicate
 * delivery of a *pre-existing* order could still double-count once; that is
 * accepted rather than backfilled, since the link table it would be rebuilt
 * from is itself only recently populated.
 */
export class Migration20260910100000AddOrderCycleSale extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "order_cycle_sale" (
        "id" TEXT NOT NULL,
        "order_cycle_id" TEXT NOT NULL,
        "order_cycle_product_id" TEXT NOT NULL,
        "variant_id" TEXT NOT NULL,
        "quantity" INTEGER NOT NULL,
        "source" TEXT NOT NULL DEFAULT 'medusa_order',
        "source_id" TEXT NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "order_cycle_sale_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_OCS_ORDER_CYCLE_ID" ON "order_cycle_sale" ("order_cycle_id");`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_OCS_SOURCE" ON "order_cycle_sale" ("source", "source_id");`)
    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_OCS_DEDUPE"
        ON "order_cycle_sale" ("order_cycle_id", "variant_id", "source", "source_id")
        WHERE "source_id" IS NOT NULL AND "deleted_at" IS NULL;
    `)
  }

  async down(): Promise<void> {
    this.addSql(`DROP INDEX IF EXISTS "IDX_OCS_DEDUPE";`)
    this.addSql(`DROP INDEX IF EXISTS "IDX_OCS_SOURCE";`)
    this.addSql(`DROP INDEX IF EXISTS "IDX_OCS_ORDER_CYCLE_ID";`)
    this.addSql(`DROP TABLE IF EXISTS "order_cycle_sale";`)
  }
}
