import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260711130500CreateNurseryInventory extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "mother_plant" ("id" text not null, "seller_id" text not null, "species_name" text not null, "location" text not null, "last_harvest_at" timestamptz null, "next_harvest_window" text null, "estimated_yield" integer null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "mother_plant_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_mother_plant_deleted_at" ON "mother_plant" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_mother_plant_seller_id" ON "mother_plant" ("seller_id") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "nursery_doa_claim" ("id" text not null, "seller_id" text not null, "order_id" text not null, "species_name" text not null, "buyer_reason" text not null, "opened_at" timestamptz not null, "status" text check ("status" in ('open', 'resolved')) not null default 'open', "resolved_at" timestamptz null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "nursery_doa_claim_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_nursery_doa_claim_deleted_at" ON "nursery_doa_claim" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_nursery_doa_claim_seller_id" ON "nursery_doa_claim" ("seller_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_nursery_doa_claim_status" ON "nursery_doa_claim" ("status") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_nursery_doa_claim_order_id" ON "nursery_doa_claim" ("order_id") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "mother_plant" cascade;`);
    this.addSql(`drop table if exists "nursery_doa_claim" cascade;`);
  }

}
