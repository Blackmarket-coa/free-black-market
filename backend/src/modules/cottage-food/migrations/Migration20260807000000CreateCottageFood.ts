import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260807000000CreateCottageFood extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "cottage_food_profile" ("id" text not null, "seller_id" text not null, "operation_type" text check ("operation_type" in ('SHELF_STABLE', 'HOME_KITCHEN', 'BOTH')) not null default 'SHELF_STABLE', "jurisdiction_label" text null, "state_code" text null, "permit_number" text null, "permit_type_label" text null, "permit_issuer" text null, "permit_issued_at" timestamptz null, "permit_expires_at" timestamptz null, "food_handler_cert_number" text null, "food_handler_expires_at" timestamptz null, "annual_sales_cap_cents" numeric null, "raw_annual_sales_cap_cents" jsonb null, "cap_period_start_month" integer not null default 1, "daily_meal_cap" integer null, "weekly_meal_cap" integer null, "timezone" text not null default 'America/New_York', "allows_pickup" boolean not null default true, "allows_delivery" boolean not null default false, "allows_shipping" boolean not null default false, "allows_out_of_state" boolean not null default false, "allows_wholesale" boolean not null default false, "label_disclosure_text" text null, "label_business_name" text null, "label_address" text null, "show_address_publicly" boolean not null default false, "public_disclosure_opt_in" boolean not null default true, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "cottage_food_profile_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_cottage_food_profile_deleted_at" ON "cottage_food_profile" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_cottage_food_profile_seller_id_unique" ON "cottage_food_profile" ("seller_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_cottage_food_profile_seller_id" ON "cottage_food_profile" ("seller_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_cottage_food_profile_operation_type" ON "cottage_food_profile" ("operation_type") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "cottage_food_sales_entry" ("id" text not null, "seller_id" text not null, "profile_id" text null, "source" text check ("source" in ('medusa_order', 'food_order', 'manual')) not null default 'medusa_order', "source_id" text null, "occurred_at" timestamptz not null, "amount_cents" numeric not null default 0, "raw_amount_cents" jsonb not null default '{"value":"0","precision":20}', "meal_count" integer not null default 0, "counts_toward_annual" boolean not null default true, "counts_toward_meals" boolean not null default true, "reverses_entry_id" text null, "note" text null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "cottage_food_sales_entry_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_cottage_food_sales_entry_deleted_at" ON "cottage_food_sales_entry" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_cottage_food_sales_entry_seller_id" ON "cottage_food_sales_entry" ("seller_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_cottage_food_sales_entry_occurred_at" ON "cottage_food_sales_entry" ("occurred_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_cottage_food_sales_entry_seller_occurred" ON "cottage_food_sales_entry" ("seller_id", "occurred_at") WHERE deleted_at IS NULL;`);
    // Idempotency guard for the order subscriber: one counted entry per
    // platform order. Partial so manual entries (source_id IS NULL) stay
    // freely appendable — two identical cash sales are two real sales.
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_cottage_food_sales_entry_source" ON "cottage_food_sales_entry" ("source", "source_id") WHERE source_id IS NOT NULL AND deleted_at IS NULL;`);

    this.addSql(`create table if not exists "cottage_food_label" ("id" text not null, "seller_id" text not null, "product_id" text null, "botanical_formula_id" text null, "product_name" text not null, "net_weight_text" text null, "ingredients" jsonb null, "allergens" jsonb null, "allergen_cross_contact_note" text null, "disclosure_text_snapshot" text null, "business_name_snapshot" text null, "address_snapshot" text null, "permit_number_snapshot" text null, "seller_reviewed_at" timestamptz null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "cottage_food_label_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_cottage_food_label_deleted_at" ON "cottage_food_label" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_cottage_food_label_seller_id" ON "cottage_food_label" ("seller_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_cottage_food_label_product_id" ON "cottage_food_label" ("product_id") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "cottage_food_label" cascade;`);
    this.addSql(`drop table if exists "cottage_food_sales_entry" cascade;`);
    this.addSql(`drop table if exists "cottage_food_profile" cascade;`);
  }

}
