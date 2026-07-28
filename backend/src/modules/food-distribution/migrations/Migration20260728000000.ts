import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Add ownership tracking to couriers so the /store/couriers/[id] routes can
 * authorize update / claim / deactivate to the account that created the
 * courier. Both columns are nullable so existing couriers are unaffected
 * (grandfathered — any authenticated actor may still manage them); new
 * couriers are stamped at creation.
 *
 * Mirrors Migration20260706000000 (delivery-zone ownership).
 */
export class Migration20260728000000 extends Migration {
  async up(): Promise<void> {
    this.addSql(
      `alter table if exists "food_courier" add column if not exists "owner_id" text null;`
    )
    this.addSql(
      `alter table if exists "food_courier" add column if not exists "owner_type" text null;`
    )
  }

  async down(): Promise<void> {
    this.addSql(
      `alter table if exists "food_courier" drop column if exists "owner_id";`
    )
    this.addSql(
      `alter table if exists "food_courier" drop column if exists "owner_type";`
    )
  }
}
