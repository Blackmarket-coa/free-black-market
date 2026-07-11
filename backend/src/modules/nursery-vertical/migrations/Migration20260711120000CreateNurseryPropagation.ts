import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260711120000CreateNurseryPropagation extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "propagation_batch" ("id" text not null, "seller_id" text not null, "species_name" text not null, "method" text check ("method" in ('seed', 'cutting', 'plug', 'bareroot', 'division', 'airlayer', 'layering', 'graft', 'offset')) not null, "status" text check ("status" in ('started', 'germinating', 'rooting', 'growing_out', 'ready', 'listed', 'sold_out', 'failed')) not null default 'started', "qty_started" integer not null, "qty_successful" integer not null default 0, "started_at" timestamptz not null, "expected_ready_at" timestamptz not null, "pot_size" text null, "is_rare_species" boolean not null default false, "hub_requested" boolean not null default false, "photo_url" text null, "photo_verified_at" timestamptz null, "notes" text null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "propagation_batch_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_propagation_batch_deleted_at" ON "propagation_batch" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_propagation_batch_seller_id" ON "propagation_batch" ("seller_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_propagation_batch_status" ON "propagation_batch" ("status") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_propagation_batch_expected_ready_at" ON "propagation_batch" ("expected_ready_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "stratification_record" ("id" text not null, "seller_id" text not null, "species_name" text not null, "type" text not null, "start_at" timestamptz not null, "duration_days" integer not null, "end_at" timestamptz not null, "location" text null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "stratification_record_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_stratification_record_deleted_at" ON "stratification_record" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_stratification_record_seller_id" ON "stratification_record" ("seller_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_stratification_record_end_at" ON "stratification_record" ("end_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "propagation_batch" cascade;`);
    this.addSql(`drop table if exists "stratification_record" cascade;`);
  }

}
