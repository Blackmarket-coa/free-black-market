import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260228112000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table if not exists "tenancy_organization" ("id" text not null, "name" text not null, "slug" text not null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "tenancy_organization_pkey" primary key ("id"));`)
    this.addSql(`create unique index if not exists "IDX_tenancy_organization_slug" on "tenancy_organization" ("slug") where deleted_at is null;`)

    this.addSql(`create table if not exists "tenancy_storefront" ("id" text not null, "organization_id" text not null, "name" text not null, "slug" text not null, "tier" text check ("tier" in ('tier0_public', 'tier1_verified', 'tier2_aligned_org')) not null default 'tier0_public', "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "tenancy_storefront_pkey" primary key ("id"));`)
    this.addSql(`create unique index if not exists "IDX_tenancy_storefront_slug" on "tenancy_storefront" ("slug") where deleted_at is null;`)

    this.addSql(`create table if not exists "tenancy_membership" ("id" text not null, "user_id" text not null, "organization_id" text not null, "storefront_id" text not null, "role" text check ("role" in ('org_owner', 'storefront_admin', 'catalog_manager', 'finance_viewer')) not null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "tenancy_membership_pkey" primary key ("id"));`)
    this.addSql(`create index if not exists "IDX_tenancy_membership_lookup" on "tenancy_membership" ("user_id", "organization_id", "storefront_id");`)
    this.addSql(`create table if not exists "tenancy_onboarding_state" ("id" text not null, "organization_id" text not null, "storefront_id" text not null, "first_listing_created" boolean not null default false, "payout_configured" boolean not null default false, "first_order_simulated" boolean not null default false, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "tenancy_onboarding_state_pkey" primary key ("id"));`)
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "tenancy_onboarding_state" cascade;`)
    this.addSql(`drop table if exists "tenancy_membership" cascade;`)
    this.addSql(`drop table if exists "tenancy_storefront" cascade;`)
    this.addSql(`drop table if exists "tenancy_organization" cascade;`)
  }
}
