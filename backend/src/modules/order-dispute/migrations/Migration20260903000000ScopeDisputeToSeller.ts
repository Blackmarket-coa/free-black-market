import { Migration } from "@mikro-orm/migrations"

/**
 * Scope the live-dispute uniqueness to (order_id, seller_id).
 *
 * The original index was unique on `order_id` alone. On a single-vendor order
 * that is right. FBM is a multi-vendor marketplace and a cart routinely spans
 * sellers, so on those orders it was wrong in a way that silently took a
 * remedy away: once a buyer filed against Vendor A, `UQ_order_dispute_live`
 * refused any dispute against Vendor B on the same order until the first one
 * resolved. The buyer's only recourse for B's goods was to wait out an
 * argument about A's.
 *
 * The rationale for the original index still holds within a vendor — two live
 * claims against the same vendor on the same order are the same argument, and
 * two admins could resolve them in opposite directions. Adding `seller_id`
 * keeps that and drops the part that was never true of a multi-vendor order.
 */
export class Migration20260903000000ScopeDisputeToSeller extends Migration {
  async up(): Promise<void> {
    this.addSql(`DROP INDEX IF EXISTS "UQ_order_dispute_live";`)
    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_order_dispute_live"
        ON "order_dispute" ("order_id", "seller_id")
        WHERE "deleted_at" IS NULL AND "status" IN ('open', 'under_review');
    `)
  }

  async down(): Promise<void> {
    this.addSql(`DROP INDEX IF EXISTS "UQ_order_dispute_live";`)
    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_order_dispute_live"
        ON "order_dispute" ("order_id")
        WHERE "deleted_at" IS NULL AND "status" IN ('open', 'under_review');
    `)
  }
}
