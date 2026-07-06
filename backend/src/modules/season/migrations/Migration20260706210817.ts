import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260706210817 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "garden_growing_plan" ("id" text not null, "garden_id" text not null, "season_id" text null, "name" text not null, "description" text null, "plan_type" text check ("plan_type" in ('template', 'seasonal', 'crop_rotation')) not null default 'seasonal', "is_template" boolean not null default false, "template_source_id" text null, "planned_crops" jsonb not null, "succession_schedule" jsonb null, "companion_notes" text null, "previous_crops" jsonb null, "rotation_family" jsonb null, "seeds_needed" jsonb null, "supplies_needed" jsonb null, "estimated_cost" numeric null, "status" text check ("status" in ('draft', 'approved', 'active', 'complete')) not null default 'draft', "approved_by_id" text null, "approved_at" timestamptz null, "created_by_id" text null, "metadata" jsonb null, "raw_estimated_cost" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "garden_growing_plan_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_garden_growing_plan_deleted_at" ON "garden_growing_plan" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "garden_planting" ("id" text not null, "season_id" text not null, "garden_id" text not null, "plot_id" text null, "crop_type" text not null, "variety" text null, "category" text check ("category" in ('vegetable', 'fruit', 'herb', 'flower', 'cover_crop', 'other')) not null default 'vegetable', "source_type" text check ("source_type" in ('seed', 'transplant', 'cutting', 'division')) not null default 'seed', "source_vendor_id" text null, "source_notes" text null, "started_at" timestamptz null, "planted_at" timestamptz null, "expected_harvest" timestamptz null, "actual_harvest_start" timestamptz null, "actual_harvest_end" timestamptz null, "quantity" integer not null, "unit" text not null, "spacing_inches" integer null, "expected_yield" numeric null, "yield_unit" text null, "status" text check ("status" in ('planned', 'started', 'planted', 'growing', 'flowering', 'fruiting', 'ready', 'harvesting', 'harvested', 'failed')) not null default 'planned', "actual_yield" numeric null, "health_status" text check ("health_status" in ('excellent', 'good', 'fair', 'poor', 'dead')) null, "issues" jsonb null, "care_log" jsonb null, "photo_urls" jsonb null, "planted_by_id" text null, "notes" text null, "metadata" jsonb null, "raw_expected_yield" jsonb null, "raw_actual_yield" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "garden_planting_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_garden_planting_deleted_at" ON "garden_planting" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "garden_season" ("id" text not null, "garden_id" text not null, "name" text not null, "year" integer not null, "season_type" text check ("season_type" in ('spring', 'summer', 'fall', 'winter', 'year_round')) not null, "planning_start" timestamptz not null, "planting_start" timestamptz not null, "growing_start" timestamptz not null, "harvest_start" timestamptz not null, "season_end" timestamptz not null, "status" text check ("status" in ('planning', 'planting', 'growing', 'harvesting', 'complete', 'cancelled')) not null default 'planning', "goals" jsonb null, "planned_budget" numeric null, "actual_spent" numeric not null default 0, "target_volunteers" integer null, "target_plot_holders" integer null, "results" jsonb null, "weather_notes" text null, "retrospective" text null, "metadata" jsonb null, "raw_planned_budget" jsonb null, "raw_actual_spent" jsonb not null default '{"value":"0","precision":20}', "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "garden_season_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_garden_season_deleted_at" ON "garden_season" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "garden_growing_plan" cascade;`);

    this.addSql(`drop table if exists "garden_planting" cascade;`);

    this.addSql(`drop table if exists "garden_season" cascade;`);
  }

}
