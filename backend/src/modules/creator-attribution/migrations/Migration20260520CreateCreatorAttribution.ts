import { Migration } from "@mikro-orm/migrations"

export class Migration20260520CreateCreatorAttribution extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      DO $$ BEGIN
        CREATE TYPE "affiliate_link_status_enum" AS ENUM (
          'active', 'paused', 'revoked'
        );
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)

    this.addSql(`
      DO $$ BEGIN
        CREATE TYPE "promo_code_binding_priority_enum" AS ENUM (
          'override_link', 'fallback', 'tie_breaker'
        );
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)

    this.addSql(`
      DO $$ BEGIN
        CREATE TYPE "promo_code_binding_status_enum" AS ENUM (
          'active', 'paused', 'revoked'
        );
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)

    this.addSql(`
      DO $$ BEGIN
        CREATE TYPE "attribution_source_enum" AS ENUM (
          'link_click', 'promo_code', 'direct_landing', 'embed_widget'
        );
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)

    this.addSql(`
      DO $$ BEGIN
        CREATE TYPE "attribution_model_enum" AS ENUM (
          'last_click', 'first_click', 'linear'
        );
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)

    this.addSql(`
      DO $$ BEGIN
        CREATE TYPE "commission_status_enum" AS ENUM (
          'pending', 'held', 'approved', 'paid', 'reversed', 'disqualified'
        );
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)

    // affiliate_link
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "affiliate_link" (
        "id" TEXT NOT NULL,
        "short_code" TEXT NOT NULL UNIQUE,
        "creator_seller_id" TEXT NOT NULL,
        "deal_id" TEXT NULL,
        "program_id" TEXT NULL,
        "vendor_id" TEXT NULL,
        "product_id" TEXT NULL,
        "collection_id" TEXT NULL,
        "destination_path" TEXT NOT NULL,
        "utm_source" TEXT NOT NULL DEFAULT 'creator',
        "utm_medium" TEXT NULL,
        "utm_campaign" TEXT NULL,
        "utm_content" TEXT NULL,
        "allowed_origins" JSONB NULL,
        "status" affiliate_link_status_enum NOT NULL DEFAULT 'active',
        "click_count" INTEGER NOT NULL DEFAULT 0,
        "attributed_order_count" INTEGER NOT NULL DEFAULT 0,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "affiliate_link_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_affiliate_link_creator" ON "affiliate_link" ("creator_seller_id");`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_affiliate_link_program" ON "affiliate_link" ("program_id");`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_affiliate_link_status" ON "affiliate_link" ("status");`)

    // promo_code_binding
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "promo_code_binding" (
        "id" TEXT NOT NULL,
        "promotion_id" TEXT NOT NULL,
        "promotion_code" TEXT NOT NULL UNIQUE,
        "creator_seller_id" TEXT NOT NULL,
        "deal_id" TEXT NULL,
        "program_id" TEXT NULL,
        "vendor_id" TEXT NULL,
        "attribution_priority" promo_code_binding_priority_enum NOT NULL DEFAULT 'override_link',
        "status" promo_code_binding_status_enum NOT NULL DEFAULT 'active',
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "promo_code_binding_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_promo_binding_creator" ON "promo_code_binding" ("creator_seller_id");`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_promo_binding_promotion" ON "promo_code_binding" ("promotion_id");`)

    // attribution_click_event
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "attribution_click_event" (
        "id" TEXT NOT NULL,
        "short_code" TEXT NOT NULL,
        "affiliate_link_id" TEXT NOT NULL,
        "creator_seller_id" TEXT NOT NULL,
        "visitor_token" TEXT NOT NULL,
        "ip_hash" TEXT NULL,
        "user_agent_hash" TEXT NULL,
        "referrer" TEXT NULL,
        "country" TEXT NULL,
        "customer_id" TEXT NULL,
        "fingerprint" TEXT NULL,
        "is_bot_suspected" BOOLEAN NOT NULL DEFAULT FALSE,
        "occurred_at" TIMESTAMPTZ NOT NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "attribution_click_event_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_click_event_visitor_time" ON "attribution_click_event" ("visitor_token", "occurred_at");`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_click_event_link_time" ON "attribution_click_event" ("affiliate_link_id", "occurred_at");`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_click_event_creator_time" ON "attribution_click_event" ("creator_seller_id", "occurred_at");`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_click_event_short_code" ON "attribution_click_event" ("short_code");`)

    // order_attribution
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "order_attribution" (
        "id" TEXT NOT NULL,
        "order_id" TEXT NOT NULL UNIQUE,
        "customer_id" TEXT NULL,
        "creator_seller_id" TEXT NOT NULL,
        "affiliate_link_id" TEXT NULL,
        "promo_code_binding_id" TEXT NULL,
        "deal_id" TEXT NULL,
        "program_id" TEXT NULL,
        "vendor_id" TEXT NULL,
        "source" attribution_source_enum NOT NULL,
        "attribution_model" attribution_model_enum NOT NULL DEFAULT 'last_click',
        "click_event_id" TEXT NULL,
        "cookie_window_days" INTEGER NOT NULL DEFAULT 7,
        "attribution_decided_at" TIMESTAMPTZ NOT NULL,
        "attributed_subtotal_cents" NUMERIC NOT NULL,
        "commission_basis_cents" NUMERIC NOT NULL,
        "commission_amount_cents" NUMERIC NOT NULL,
        "commission_percent" NUMERIC NULL,
        "currency_code" TEXT NOT NULL DEFAULT 'usd',
        "commission_status" commission_status_enum NOT NULL DEFAULT 'pending',
        "hold_until" TIMESTAMPTZ NULL,
        "ledger_entry_id" TEXT NULL,
        "disqualified_reason" TEXT NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "order_attribution_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_order_attribution_creator_status" ON "order_attribution" ("creator_seller_id", "commission_status");`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_order_attribution_program" ON "order_attribution" ("program_id");`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_order_attribution_deal" ON "order_attribution" ("deal_id");`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_order_attribution_status_hold" ON "order_attribution" ("commission_status", "hold_until");`)
  }

  async down(): Promise<void> {
    this.addSql('DROP TABLE IF EXISTS "order_attribution" CASCADE;')
    this.addSql('DROP TABLE IF EXISTS "attribution_click_event" CASCADE;')
    this.addSql('DROP TABLE IF EXISTS "promo_code_binding" CASCADE;')
    this.addSql('DROP TABLE IF EXISTS "affiliate_link" CASCADE;')
    this.addSql('DROP TYPE IF EXISTS "commission_status_enum" CASCADE;')
    this.addSql('DROP TYPE IF EXISTS "attribution_model_enum" CASCADE;')
    this.addSql('DROP TYPE IF EXISTS "attribution_source_enum" CASCADE;')
    this.addSql('DROP TYPE IF EXISTS "promo_code_binding_status_enum" CASCADE;')
    this.addSql('DROP TYPE IF EXISTS "promo_code_binding_priority_enum" CASCADE;')
    this.addSql('DROP TYPE IF EXISTS "affiliate_link_status_enum" CASCADE;')
  }
}
