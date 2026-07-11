import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260711130000CreateBotanicalProduction extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "botanical_formula" ("id" text not null, "maker_id" text not null, "pathway_id" text not null, "name" text not null, "description" text null, "version" text not null default '1.0.0', "status" text check ("status" in ('draft', 'approved', 'deprecated')) not null default 'draft', "ingredients" jsonb not null, "instructions" text null, "yield_units" integer not null default 0, "yield_unit_type" text not null default 'unit', "cure_time_days" integer null, "shelf_life_days" integer null, "storage_conditions" text null, "ph_target" real null, "label_claims" jsonb null, "allergens" jsonb null, "cost_per_unit_cents" integer not null default 0, "target_retail_price_cents" integer not null default 0, "target_wholesale_price_cents" integer not null default 0, "label_reviewed" boolean not null default false, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "botanical_formula_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_botanical_formula_deleted_at" ON "botanical_formula" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_botanical_formula_maker_id" ON "botanical_formula" ("maker_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_botanical_formula_pathway_id" ON "botanical_formula" ("pathway_id") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "botanical_production_run" ("id" text not null, "maker_id" text not null, "formula_id" text not null, "formula_name" text not null, "pathway_id" text not null, "batch_number" text not null, "planned_date" timestamptz not null, "actual_start_date" timestamptz null, "actual_complete_date" timestamptz null, "cure_complete_date" timestamptz null, "planned_yield_units" integer not null default 0, "actual_yield_units" integer null, "yield_unit_type" text not null default 'unit', "status" text check ("status" in ('planned', 'in_progress', 'curing', 'testing', 'complete', 'failed', 'quarantine')) not null default 'planned', "total_cost_cents" integer not null default 0, "qc_passed" boolean null, "ph_reading" real null, "coa_url" text null, "notes" text null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "botanical_production_run_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_botanical_production_run_deleted_at" ON "botanical_production_run" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_botanical_production_run_maker_id" ON "botanical_production_run" ("maker_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_botanical_production_run_pathway_id" ON "botanical_production_run" ("pathway_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_botanical_production_run_status" ON "botanical_production_run" ("status") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_botanical_production_run_batch_number" ON "botanical_production_run" ("batch_number") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "botanical_raw_material" ("id" text not null, "maker_id" text not null, "name" text not null, "common_name" text not null, "botanical_name" text null, "category" text check ("category" in ('plant_material', 'carrier_base', 'additive', 'packaging', 'fiber', 'fungal', 'seed', 'hardware', 'other')) not null default 'plant_material', "pathway_id" text null, "source_default" text check ("source_default" in ('bmc_nursery', 'own_harvest', 'foraged', 'external_supplier', 'traded')) not null default 'external_supplier', "current_stock" real not null default 0, "stock_unit" text not null default 'oz', "reorder_threshold" real not null default 0, "cost_per_unit_cents" integer not null default 0, "lots" jsonb null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "botanical_raw_material_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_botanical_raw_material_deleted_at" ON "botanical_raw_material" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_botanical_raw_material_maker_id" ON "botanical_raw_material" ("maker_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_botanical_raw_material_category" ON "botanical_raw_material" ("category") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "botanical_finished_good" ("id" text not null, "maker_id" text not null, "formula_id" text not null, "pathway_id" text not null, "output_category" text check ("output_category" in ('dried_botanical', 'extract_tincture', 'prepared_food', 'cosmetic_body_care', 'craft_fiber_dye', 'seed_packet', 'fungal_product', 'bulk_ingredient', 'digital_recipe', 'custom')) not null, "batch_number" text not null, "sku" text not null, "product_name" text not null, "quantity_on_hand" integer not null default 0, "unit_size" text not null default '', "unit_type" text not null default 'unit', "manufacture_date" timestamptz not null, "expiry_date" timestamptz null, "germination_rate" real null, "germination_test_date" timestamptz null, "status" text check ("status" in ('available', 'reserved', 'shipped', 'quarantine', 'expired')) not null default 'available', "is_wholesale_eligible" boolean not null default false, "retail_price_cents" integer not null default 0, "wholesale_price_cents" integer not null default 0, "label_approved" boolean not null default false, "coa_required" boolean not null default false, "coa_url" text null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "botanical_finished_good_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_botanical_finished_good_deleted_at" ON "botanical_finished_good" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_botanical_finished_good_maker_id" ON "botanical_finished_good" ("maker_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_botanical_finished_good_pathway_id" ON "botanical_finished_good" ("pathway_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_botanical_finished_good_status" ON "botanical_finished_good" ("status") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_botanical_finished_good_sku" ON "botanical_finished_good" ("sku") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "botanical_ph_test_log" ("id" text not null, "maker_id" text not null, "pathway_id" text not null, "batch_number" text not null, "formula_name" text not null, "test_date" timestamptz not null, "ph_reading" real not null, "method" text check ("method" in ('meter', 'strips', 'lab')) not null default 'meter', "pass" boolean not null, "notes" text null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "botanical_ph_test_log_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_botanical_ph_test_log_deleted_at" ON "botanical_ph_test_log" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_botanical_ph_test_log_maker_id" ON "botanical_ph_test_log" ("maker_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_botanical_ph_test_log_batch_number" ON "botanical_ph_test_log" ("batch_number") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "botanical_germination_log" ("id" text not null, "maker_id" text not null, "lot_number" text not null, "species_name" text not null, "botanical_name" text null, "test_date" timestamptz not null, "seeds_tested" integer not null, "seeds_germinated" integer not null, "germination_rate_pct" real not null, "method" text check ("method" in ('paper_towel', 'soil', 'lab')) not null default 'paper_towel', "alert" boolean not null default false, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "botanical_germination_log_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_botanical_germination_log_deleted_at" ON "botanical_germination_log" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_botanical_germination_log_maker_id" ON "botanical_germination_log" ("maker_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_botanical_germination_log_lot_number" ON "botanical_germination_log" ("lot_number") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "botanical_formula" cascade;`);
    this.addSql(`drop table if exists "botanical_production_run" cascade;`);
    this.addSql(`drop table if exists "botanical_raw_material" cascade;`);
    this.addSql(`drop table if exists "botanical_finished_good" cascade;`);
    this.addSql(`drop table if exists "botanical_ph_test_log" cascade;`);
    this.addSql(`drop table if exists "botanical_germination_log" cascade;`);
  }

}
