import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Extend CLASS-B ownership tracking to food producers and delivery batches so
 * the /store/food-producers/[id] and /store/delivery-batches/[id] routes can
 * authorize writes to the account that created the row. All columns are
 * nullable so existing rows are grandfathered (any authenticated actor may
 * still manage them); new rows are stamped at creation.
 *
 * Mirrors Migration20260728000000 (courier ownership).
 */
export class Migration20260728000001 extends Migration {
  async up(): Promise<void> {
    this.addSql(
      `alter table if exists "food_producer" add column if not exists "owner_id" text null;`
    )
    this.addSql(
      `alter table if exists "food_producer" add column if not exists "owner_type" text null;`
    )
    this.addSql(
      `alter table if exists "food_delivery_batch" add column if not exists "owner_id" text null;`
    )
    this.addSql(
      `alter table if exists "food_delivery_batch" add column if not exists "owner_type" text null;`
    )
  }

  async down(): Promise<void> {
    this.addSql(
      `alter table if exists "food_producer" drop column if exists "owner_id";`
    )
    this.addSql(
      `alter table if exists "food_producer" drop column if exists "owner_type";`
    )
    this.addSql(
      `alter table if exists "food_delivery_batch" drop column if exists "owner_id";`
    )
    this.addSql(
      `alter table if exists "food_delivery_batch" drop column if exists "owner_type";`
    )
  }
}
