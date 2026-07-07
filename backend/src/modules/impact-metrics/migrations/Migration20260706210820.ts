import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260706210820 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "producer_impact" drop constraint if exists "producer_impact_seller_id_unique";`);
    this.addSql(`alter table if exists "order_impact" drop constraint if exists "order_impact_order_id_unique";`);
    this.addSql(`alter table if exists "buyer_impact" drop constraint if exists "buyer_impact_customer_id_unique";`);
    this.addSql(`alter table if exists "buyer_badge" drop constraint if exists "buyer_badge_badge_type_unique";`);
    this.addSql(`create table if not exists "buyer_badge" ("id" text not null, "badge_type" text check ("badge_type" in ('FIRST_PURCHASE', 'LOCAL_SUPPORTER', 'CO_OP_BUYER', 'REGENERATIVE_PATRON', 'SUBSCRIPTION_SUPPORTER', 'COMMUNITY_CHAMPION', 'PRODUCER_PARTNER', 'LOYAL_CUSTOMER', 'IMPACT_LEADER', 'REFERRAL_STAR')) not null, "name" text not null, "description" text not null, "icon" text not null, "color" text not null, "requirements" jsonb null, "display_order" integer not null default 100, "active" boolean not null default true, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "buyer_badge_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_buyer_badge_badge_type_unique" ON "buyer_badge" ("badge_type") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_buyer_badge_deleted_at" ON "buyer_badge" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "buyer_impact" ("id" text not null, "customer_id" text not null, "total_spent" numeric not null default 0, "total_to_producers" numeric not null default 0, "total_platform_fees" numeric not null default 0, "total_community_reinvestment" numeric not null default 0, "unique_producers_supported" integer not null default 0, "producer_ids" jsonb null, "estimated_miles_saved" integer not null default 0, "avg_food_miles" integer not null default 0, "total_orders" integer not null default 0, "repeat_orders" integer not null default 0, "subscription_orders" integer not null default 0, "first_purchase_at" timestamptz null, "last_purchase_at" timestamptz null, "months_active" integer not null default 0, "badges" jsonb null, "metadata" jsonb null, "raw_total_spent" jsonb not null default '{"value":"0","precision":20}', "raw_total_to_producers" jsonb not null default '{"value":"0","precision":20}', "raw_total_platform_fees" jsonb not null default '{"value":"0","precision":20}', "raw_total_community_reinvestment" jsonb not null default '{"value":"0","precision":20}', "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "buyer_impact_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_buyer_impact_customer_id_unique" ON "buyer_impact" ("customer_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_buyer_impact_deleted_at" ON "buyer_impact" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_buyer_impact_customer_id" ON "buyer_impact" ("customer_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_buyer_impact_total_to_producers" ON "buyer_impact" ("total_to_producers") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_buyer_impact_producers_supported" ON "buyer_impact" ("unique_producers_supported") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "order_impact" ("id" text not null, "order_id" text not null, "customer_id" text not null, "order_total" numeric not null, "producer_amount" numeric not null, "platform_fee" numeric not null, "delivery_fee" numeric not null default 0, "community_reinvestment" numeric not null default 0, "tip_amount" numeric not null default 0, "producer_breakdown" jsonb not null, "food_miles" integer not null default 0, "miles_saved" integer not null default 0, "is_local" boolean not null default true, "order_type" text check ("order_type" in ('ONE_TIME', 'SUBSCRIPTION', 'PRE_ORDER', 'STANDING')) not null default 'ONE_TIME', "is_repeat" boolean not null default false, "metadata" jsonb null, "raw_order_total" jsonb not null, "raw_producer_amount" jsonb not null, "raw_platform_fee" jsonb not null, "raw_delivery_fee" jsonb not null default '{"value":"0","precision":20}', "raw_community_reinvestment" jsonb not null default '{"value":"0","precision":20}', "raw_tip_amount" jsonb not null default '{"value":"0","precision":20}', "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "order_impact_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_order_impact_order_id_unique" ON "order_impact" ("order_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_order_impact_deleted_at" ON "order_impact" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_order_impact_order_id" ON "order_impact" ("order_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_order_impact_customer_id" ON "order_impact" ("customer_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_order_impact_created_at" ON "order_impact" ("created_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "producer_impact" ("id" text not null, "seller_id" text not null, "total_revenue" numeric not null default 0, "total_payout" numeric not null default 0, "total_platform_fees" numeric not null default 0, "total_tips" numeric not null default 0, "revenue_stability_score" integer not null default 0, "subscription_revenue_percent" integer not null default 0, "repeat_customer_revenue_percent" integer not null default 0, "total_customers" integer not null default 0, "repeat_customers" integer not null default 0, "active_subscribers" integer not null default 0, "total_orders" integer not null default 0, "avg_order_value" numeric not null default 0, "fulfillment_reliability" integer not null default 100, "monthly_revenue" numeric not null default 0, "last_month_revenue" numeric not null default 0, "months_active" integer not null default 0, "first_sale_at" timestamptz null, "last_sale_at" timestamptz null, "local_customers" integer not null default 0, "avg_delivery_distance" integer not null default 0, "metadata" jsonb null, "raw_total_revenue" jsonb not null default '{"value":"0","precision":20}', "raw_total_payout" jsonb not null default '{"value":"0","precision":20}', "raw_total_platform_fees" jsonb not null default '{"value":"0","precision":20}', "raw_total_tips" jsonb not null default '{"value":"0","precision":20}', "raw_avg_order_value" jsonb not null default '{"value":"0","precision":20}', "raw_monthly_revenue" jsonb not null default '{"value":"0","precision":20}', "raw_last_month_revenue" jsonb not null default '{"value":"0","precision":20}', "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "producer_impact_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_producer_impact_seller_id_unique" ON "producer_impact" ("seller_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_producer_impact_deleted_at" ON "producer_impact" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_producer_impact_seller_id" ON "producer_impact" ("seller_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_producer_impact_stability" ON "producer_impact" ("revenue_stability_score") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_producer_impact_revenue" ON "producer_impact" ("total_revenue") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "buyer_badge" cascade;`);

    this.addSql(`drop table if exists "buyer_impact" cascade;`);

    this.addSql(`drop table if exists "order_impact" cascade;`);

    this.addSql(`drop table if exists "producer_impact" cascade;`);
  }

}
