import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Add ownership tracking to delivery zones so the /vendor/delivery-zones routes
 * can authorize update/delete to the zone's creator (security finding C-5).
 * Nullable so existing zones are unaffected (treated as admin-managed).
 */
export class Migration20260706000000 extends Migration {
  async up(): Promise<void> {
    this.addSql(
      `alter table if exists "food_delivery_zone" add column if not exists "created_by_seller_id" text null;`
    )
  }

  async down(): Promise<void> {
    this.addSql(
      `alter table if exists "food_delivery_zone" drop column if exists "created_by_seller_id";`
    )
  }
}
