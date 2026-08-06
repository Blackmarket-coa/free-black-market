import { Migration } from "@mikro-orm/migrations"

/**
 * Phase 4 — connect a recurring demand pool to a standing order cycle.
 *
 * A group buy re-forms from scratch every time: buyers re-post, re-commit, and
 * re-find a supplier for demand that was always going to recur. An order cycle
 * is the durable version of that relationship — a coordinator's repeating
 * ordering window. This column is the join between the two, so a pool that
 * found its supplier can hand the relationship over instead of expiring and
 * starting again.
 *
 * Additive and nullable: a pool with no linked cycle behaves exactly as before,
 * which is every pool that exists today.
 */
export class Migration20260805AddOrderCycleLink extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      ALTER TABLE "demand_post"
        ADD COLUMN IF NOT EXISTS "order_cycle_id" TEXT NULL;
    `)
    // The read this exists for: "is this recurring need already served by a
    // cycle" — a minority of rows, so a partial index.
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_demand_post_order_cycle"
        ON "demand_post" ("order_cycle_id")
        WHERE "order_cycle_id" IS NOT NULL AND "deleted_at" IS NULL;
    `)
  }

  async down(): Promise<void> {
    this.addSql('DROP INDEX IF EXISTS "IDX_demand_post_order_cycle";')
    this.addSql(`
      ALTER TABLE "demand_post"
        DROP COLUMN IF EXISTS "order_cycle_id";
    `)
  }
}
