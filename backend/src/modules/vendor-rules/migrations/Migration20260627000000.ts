import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Plant Network — Section 5: wholesale_application intake table.
 *
 * Hand-authored (parity with the order-cycle migration format) because the
 * generator requires a live DB. Creates only the new table; existing
 * vendor-rules tables are unaffected.
 */
export class Migration20260627000000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "wholesale_application" ("id" text not null, "business_name" text not null, "contact_name" text not null, "email" text not null, "phone" text not null, "state" text not null, "nursery_license_number" text null, "estimated_annual_volume_usd" integer not null default 0, "species_interests" jsonb null, "buyer_type" text check ("buyer_type" in ('garden_center', 'landscape_contractor', 'restoration', 'csa', 'other')) not null default 'other', "status" text check ("status" in ('pending', 'approved', 'rejected')) not null default 'pending', "customer_id" text null, "reviewed_by" text null, "reviewed_at" timestamptz null, "review_notes" text null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "wholesale_application_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_wholesale_application_deleted_at" ON "wholesale_application" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_wholesale_app_email" ON "wholesale_application" ("email") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_wholesale_app_status" ON "wholesale_application" ("status") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "wholesale_application" cascade;`);
  }
}
