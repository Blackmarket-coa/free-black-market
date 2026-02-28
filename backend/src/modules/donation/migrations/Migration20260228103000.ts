import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260228103000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table if not exists "donation_beneficiary" ("id" text not null, "name" text not null, "slug" text not null, "description" text null, "verification_status" text check ("verification_status" in ('pending', 'verified', 'rejected')) not null default 'pending', "website" text null, "payout_reference" text null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "donation_beneficiary_pkey" primary key ("id"));`)
    this.addSql(`create unique index if not exists "IDX_donation_beneficiary_slug" on "donation_beneficiary" ("slug") where deleted_at is null;`)

    this.addSql(`create table if not exists "donation_settings" ("id" text not null, "is_default" boolean not null default true, "settlement_mode" text check ("settlement_mode" in ('split_processor', 'ledger_batch')) not null default 'split_processor', "default_percentage" numeric not null default 2, "round_up_enabled" boolean not null default true, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "donation_settings_pkey" primary key ("id"));`)

    this.addSql(`create table if not exists "donation_disbursement" ("id" text not null, "beneficiary_id" text not null, "storefront_id" text not null default 'default', "amount" numeric not null, "currency_code" text not null default 'usd', "status" text check ("status" in ('pending', 'sent', 'failed')) not null default 'pending', "period_start" timestamptz not null, "period_end" timestamptz not null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "donation_disbursement_pkey" primary key ("id"));`)
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "donation_disbursement" cascade;`)
    this.addSql(`drop table if exists "donation_settings" cascade;`)
    this.addSql(`drop table if exists "donation_beneficiary" cascade;`)
  }
}
