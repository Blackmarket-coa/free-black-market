import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260706210816 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "batch_reservation" ("id" text not null, "harvest_batch_id" text not null, "customer_id" text null, "cart_id" text null, "session_id" text null, "quantity" integer not null, "expires_at" timestamptz not null, "converted_to_order" boolean not null default false, "order_id" text null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "batch_reservation_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_batch_reservation_deleted_at" ON "batch_reservation" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_br_batch_id" ON "batch_reservation" ("harvest_batch_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_br_cart_id" ON "batch_reservation" ("cart_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_br_expires_at" ON "batch_reservation" ("expires_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "harvest_batch" ("id" text not null, "product_variant_id" text not null, "seller_id" text not null, "batch_code" text not null, "batch_name" text null, "total_quantity" integer not null, "sold_quantity" integer not null default 0, "reserved_quantity" integer not null default 0, "unit" text not null default 'each', "harvested_at" timestamptz null, "available_from" timestamptz null, "best_by" timestamptz null, "available_until" timestamptz null, "status" text check ("status" in ('PLANNED', 'AVAILABLE', 'LOW_STOCK', 'SOLD_OUT', 'EXPIRED', 'CANCELLED')) not null default 'PLANNED', "low_stock_threshold" integer not null default 5, "season_tags" jsonb null, "custom_tags" jsonb null, "batch_price" numeric null, "preorder_discount_percent" integer not null default 0, "harvest_story" text null, "origin_location" text null, "practices" jsonb null, "batch_photos" jsonb null, "metadata" jsonb null, "raw_batch_price" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "harvest_batch_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_harvest_batch_deleted_at" ON "harvest_batch" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_hb_variant_id" ON "harvest_batch" ("product_variant_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_hb_seller_id" ON "harvest_batch" ("seller_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_hb_status" ON "harvest_batch" ("status") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_hb_batch_code" ON "harvest_batch" ("batch_code") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_hb_available_from" ON "harvest_batch" ("available_from") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_hb_best_by" ON "harvest_batch" ("best_by") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "seasonal_product" ("id" text not null, "product_id" text not null, "seller_id" text not null, "available_months" jsonb not null, "peak_months" jsonb null, "year_round_with_peaks" boolean not null default false, "seasonal_notes" text null, "availability_factors" text null, "allow_preorder" boolean not null default false, "preorder_lead_days" integer not null default 14, "notify_when_available" boolean not null default true, "notification_list" jsonb null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "seasonal_product_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_seasonal_product_deleted_at" ON "seasonal_product" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_sp_product_id" ON "seasonal_product" ("product_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_sp_seller_id" ON "seasonal_product" ("seller_id") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "batch_reservation" cascade;`);

    this.addSql(`drop table if exists "harvest_batch" cascade;`);

    this.addSql(`drop table if exists "seasonal_product" cascade;`);
  }

}
