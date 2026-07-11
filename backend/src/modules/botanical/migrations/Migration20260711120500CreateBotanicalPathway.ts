import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260711120500CreateBotanicalPathway extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "botanical_pathway" ("id" text not null, "maker_id" text not null, "template_id" text null, "name" text not null, "output_category" text check ("output_category" in ('dried_botanical', 'extract_tincture', 'prepared_food', 'cosmetic_body_care', 'craft_fiber_dye', 'seed_packet', 'fungal_product', 'bulk_ingredient', 'digital_recipe', 'custom')) not null, "compliance_framework_id" text check ("compliance_framework_id" in ('fda_cosmetic', 'fda_supplement', 'fda_food', 'fda_acidified_food', 'craft_supply', 'seed_supply', 'self_regulated', 'usda_organic')) not null, "is_active" boolean not null default true, "shelf_life_min_days" integer null, "shelf_life_max_days" integer null, "shelf_life_note" text null, "default_cure_time_days" integer null, "requires_ph_testing" boolean not null default false, "ph_threshold" real null, "coa_required_for_wholesale" boolean not null default false, "counts_toward_cottage_food_limit" boolean not null default false, "batch_number_prefix" text null, "production_status_labels" jsonb null, "material_category_labels" jsonb null, "custom_forbidden_patterns" jsonb null, "yield_unit_options" jsonb null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "botanical_pathway_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_botanical_pathway_deleted_at" ON "botanical_pathway" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_botanical_pathway_maker_id" ON "botanical_pathway" ("maker_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_botanical_pathway_is_active" ON "botanical_pathway" ("is_active") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "botanical_pathway" cascade;`);
  }

}
