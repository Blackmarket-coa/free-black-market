import { Migration } from "@mikro-orm/migrations"

export class Migration20260304120000CreateCollectiveCampaign extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      DO $$ BEGIN
        CREATE TYPE "collective_campaign_type_enum" AS ENUM ('PRODUCTION_RUN','PRODUCTIVE_ASSET');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)

    this.addSql(`
      DO $$ BEGIN
        CREATE TYPE "collective_campaign_status_enum" AS ENUM (
          'DRAFT','ACTIVE','FUNDED','SOURCING','MATERIALS_RECEIVED','PRODUCING','FULFILLING','SELLING','COMPLETE',
          'ASSET_ACQUISITION','ESTABLISHMENT','YIELDING','MATURE','FAILED','DISPUTED','WIND_DOWN'
        );
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)

    this.addSql(`
      DO $$ BEGIN
        CREATE TYPE "collective_backing_mode_enum" AS ENUM ('PRE_ORDER','MICRO_INVESTOR');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)

    this.addSql(`
      DO $$ BEGIN
        CREATE TYPE "collective_backing_status_enum" AS ENUM ('PLEDGED','REFUNDED','SETTLED');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)

    this.addSql(`
      DO $$ BEGIN
        CREATE TYPE "collective_purchase_order_status_enum" AS ENUM (
          'PENDING','AUTO_EXECUTED','MANUAL_ACTION_REQUIRED','ORDERED','SHIPPED','DELIVERED'
        );
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)

    this.addSql(`
      DO $$ BEGIN
        CREATE TYPE "collective_vendor_reputation_tier_enum" AS ENUM ('TIER_1','TIER_2','TIER_3','TIER_4');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)

    this.addSql(`
      DO $$ BEGIN
        CREATE TYPE "collective_custody_mode_enum" AS ENUM ('SELF_CUSTODY','PLATFORM_CUSTODY');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "collective_campaign" (
        "id" TEXT NOT NULL,
        "vendor_id" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "description" TEXT NOT NULL,
        "media" JSONB NULL,
        "campaign_type" collective_campaign_type_enum NOT NULL,
        "status" collective_campaign_status_enum NOT NULL DEFAULT 'DRAFT',
        "batch_minimum" INTEGER NULL,
        "funding_goal_override" NUMERIC NULL,
        "maker_fee" NUMERIC NOT NULL DEFAULT 0,
        "estimated_production_days" INTEGER NULL,
        "shipping_per_unit" NUMERIC NOT NULL DEFAULT 0,
        "pickup_enabled" BOOLEAN NOT NULL DEFAULT false,
        "return_cap_multiplier" NUMERIC NOT NULL DEFAULT 2,
        "asset_type" TEXT NULL,
        "productive_lifespan" TEXT NULL,
        "yield_per_cycle" NUMERIC NULL,
        "cycle_frequency" TEXT NULL,
        "time_to_first_yield_days" INTEGER NULL,
        "compounding_profile" TEXT NULL,
        "projected_return_curve" JSONB NULL,
        "material_total" NUMERIC NOT NULL DEFAULT 0,
        "maker_fee_subtotal" NUMERIC NOT NULL DEFAULT 0,
        "platform_fee_subtotal" NUMERIC NOT NULL DEFAULT 0,
        "shipping_subtotal" NUMERIC NOT NULL DEFAULT 0,
        "campaign_goal" NUMERIC NOT NULL DEFAULT 0,
        "per_unit_backer_cost" NUMERIC NOT NULL DEFAULT 0,
        "total_backed_amount" NUMERIC NOT NULL DEFAULT 0,
        "pre_order_backed_amount" NUMERIC NOT NULL DEFAULT 0,
        "investor_backed_amount" NUMERIC NOT NULL DEFAULT 0,
        "maker_fee_released_amount" NUMERIC NOT NULL DEFAULT 0,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "collective_campaign_pkey" PRIMARY KEY ("id")
      );
    `)

    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_collective_campaign_vendor_id" ON "collective_campaign" ("vendor_id") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_collective_campaign_status" ON "collective_campaign" ("status") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_collective_campaign_type_status" ON "collective_campaign" ("campaign_type", "status") WHERE "deleted_at" IS NULL;`)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "collective_material_line_item" (
        "id" TEXT NOT NULL,
        "campaign_id" TEXT NOT NULL,
        "item_name" TEXT NOT NULL,
        "supplier_url" TEXT NOT NULL,
        "unit_cost_at_listing" NUMERIC NOT NULL,
        "quantity_per_output_unit" NUMERIC NOT NULL DEFAULT 1,
        "quantity_per_full_campaign" NUMERIC NOT NULL,
        "auto_purchase_supported" BOOLEAN NOT NULL DEFAULT false,
        "line_total_estimate" NUMERIC NOT NULL DEFAULT 0,
        "variance_percent" REAL NOT NULL DEFAULT 0,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "collective_material_line_item_pkey" PRIMARY KEY ("id")
      );
    `)

    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_collective_material_campaign_id" ON "collective_material_line_item" ("campaign_id") WHERE "deleted_at" IS NULL;`)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "collective_backing" (
        "id" TEXT NOT NULL,
        "campaign_id" TEXT NOT NULL,
        "backer_id" TEXT NOT NULL,
        "mode" collective_backing_mode_enum NOT NULL,
        "amount" NUMERIC NOT NULL,
        "units_reserved" INTEGER NULL,
        "investor_pool_share" REAL NOT NULL DEFAULT 0,
        "payout_cap_amount" NUMERIC NULL,
        "payout_released_amount" NUMERIC NOT NULL DEFAULT 0,
        "status" collective_backing_status_enum NOT NULL DEFAULT 'PLEDGED',
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "collective_backing_pkey" PRIMARY KEY ("id")
      );
    `)

    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_collective_backing_campaign_id" ON "collective_backing" ("campaign_id") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_collective_backing_backer_id" ON "collective_backing" ("backer_id") WHERE "deleted_at" IS NULL;`)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "collective_purchase_order" (
        "id" TEXT NOT NULL,
        "campaign_id" TEXT NOT NULL,
        "material_line_item_id" TEXT NULL,
        "supplier_url" TEXT NOT NULL,
        "status" collective_purchase_order_status_enum NOT NULL DEFAULT 'PENDING',
        "budget_amount" NUMERIC NOT NULL,
        "actual_amount" NUMERIC NULL,
        "order_confirmation" TEXT NULL,
        "tracking_number" TEXT NULL,
        "carrier" TEXT NULL,
        "eta" TIMESTAMPTZ NULL,
        "delivery_status" TEXT NULL,
        "receipt_data" JSONB NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "collective_purchase_order_pkey" PRIMARY KEY ("id")
      );
    `)

    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_collective_po_campaign_id" ON "collective_purchase_order" ("campaign_id") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_collective_po_status" ON "collective_purchase_order" ("status") WHERE "deleted_at" IS NULL;`)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "collective_vendor_reputation" (
        "id" TEXT NOT NULL,
        "vendor_id" TEXT NOT NULL,
        "tier" collective_vendor_reputation_tier_enum NOT NULL DEFAULT 'TIER_1',
        "campaign_cap" NUMERIC NULL,
        "unresolved_disputes_in_row" INTEGER NOT NULL DEFAULT 0,
        "total_disputes" INTEGER NOT NULL DEFAULT 0,
        "suspended" BOOLEAN NOT NULL DEFAULT false,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "collective_vendor_reputation_pkey" PRIMARY KEY ("id")
      );
    `)

    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_collective_vendor_reputation_vendor_id" ON "collective_vendor_reputation" ("vendor_id") WHERE "deleted_at" IS NULL;`)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "collective_productive_asset_token" (
        "id" TEXT NOT NULL,
        "campaign_id" TEXT NOT NULL,
        "token_contract_address" TEXT NOT NULL,
        "chain_id" INTEGER NOT NULL,
        "token_standard" TEXT NOT NULL DEFAULT 'ERC-1155',
        "total_supply" NUMERIC NOT NULL,
        "metadata_uri" TEXT NULL,
        "custody_mode" collective_custody_mode_enum NOT NULL DEFAULT 'PLATFORM_CUSTODY',
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "collective_productive_asset_token_pkey" PRIMARY KEY ("id")
      );
    `)

    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_collective_asset_token_campaign_id" ON "collective_productive_asset_token" ("campaign_id") WHERE "deleted_at" IS NULL;`)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "collective_yield_report" (
        "id" TEXT NOT NULL,
        "campaign_id" TEXT NOT NULL,
        "cycle_label" TEXT NOT NULL,
        "measured_output" NUMERIC NOT NULL,
        "payout_pool_amount" NUMERIC NOT NULL DEFAULT 0,
        "projected_next_cycle_output" NUMERIC NULL,
        "oracle_reference" TEXT NULL,
        "reported_at" TIMESTAMPTZ NOT NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "collective_yield_report_pkey" PRIMARY KEY ("id")
      );
    `)

    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_collective_yield_campaign_id" ON "collective_yield_report" ("campaign_id") WHERE "deleted_at" IS NULL;`)
  }
}
