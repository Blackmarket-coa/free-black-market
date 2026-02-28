import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260228090000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table if not exists "ledger_event" ("id" text not null, "storefront_id" text not null, "event_type" text check ("event_type" in ('order_captured', 'platform_fee_assessed', 'vendor_payout_accrued', 'donation_accrued', 'refund_issued', 'payout_released')) not null, "amount" numeric not null, "currency_code" text not null default 'usd', "occurred_at" timestamptz not null, "reference_id" text null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "ledger_event_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_ledger_event_deleted_at" ON "ledger_event" (deleted_at) WHERE deleted_at IS NULL;`);
    this.addSql(`create index if not exists "IDX_ledger_event_storefront_date" on "ledger_event" ("storefront_id", "occurred_at");`);

    this.addSql(`create table if not exists "reconciliation_alert" ("id" text not null, "storefront_id" text not null, "start_date" timestamptz not null, "end_date" timestamptz not null, "severity" text not null default 'high', "message" text not null, "details" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "reconciliation_alert_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_reconciliation_alert_deleted_at" ON "reconciliation_alert" (deleted_at) WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "reconciliation_alert" cascade;`);
    this.addSql(`drop table if exists "ledger_event" cascade;`);
  }
}
