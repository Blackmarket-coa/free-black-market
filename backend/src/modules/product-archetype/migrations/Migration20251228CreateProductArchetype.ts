import { Migration } from "@mikro-orm/migrations"

export class Migration20251228CreateProductArchetype extends Migration {
  async up(): Promise<void> {
    // Create product_archetype_code enum with the full set of values across
    // all subsequent module passes (community + marketplace). Subsequent
    // ALTER TYPE ADD VALUE migrations (Migration20260202000AddCommunity*,
    // Migration20260506000AddMarketplace*) are kept for prod-DB history but
    // are no-ops on a fresh DB via `ADD VALUE IF NOT EXISTS`. The reason
    // values are created up-front: when the migrator wraps everything in
    // one master transaction (mikro-orm `allOrNothing`), a non-transactional
    // ALTER on a side connection cannot see the uncommitted CREATE TYPE.
    this.addSql(`
      DO $$ BEGIN
        CREATE TYPE "product_archetype_code_enum" AS ENUM (
          'AGRICULTURAL_RAW',
          'AGRICULTURAL_PROCESSED',
          'RESTAURANT_PREPARED',
          'NON_PERISHABLE',
          'DIGITAL',
          'TICKET',
          'SUBSCRIPTION',
          'LAND_ACCESS',
          'MUTUAL_AID',
          'CIRCULAR_ECONOMY',
          'COMMUNITY_SERVICE',
          'EXPERIMENTAL',
          'SERVICE',
          'PLUGIN',
          'THEME',
          'EMOJI_PACK',
          'ACCESS_PASS'
        );
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `)

    // Create inventory_strategy enum
    this.addSql(`
      DO $$ BEGIN
        CREATE TYPE "inventory_strategy_enum" AS ENUM (
          'STANDARD',
          'LOT_BASED',
          'UNLIMITED',
          'CAPACITY',
          'NONE'
        );
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `)

    // Create product_archetype table
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "product_archetype" (
        "id" TEXT NOT NULL,
        "code" product_archetype_code_enum NOT NULL UNIQUE,
        "name" TEXT NOT NULL,
        "description" TEXT NULL,
        "inventory_strategy" inventory_strategy_enum NOT NULL DEFAULT 'STANDARD',
        "requires_availability_window" BOOLEAN NOT NULL DEFAULT false,
        "supports_preorder" BOOLEAN NOT NULL DEFAULT false,
        "perishable" BOOLEAN NOT NULL DEFAULT false,
        "perishable_shelf_days" INTEGER NULL,
        "requires_shipping" BOOLEAN NOT NULL DEFAULT true,
        "supports_pickup" BOOLEAN NOT NULL DEFAULT true,
        "supports_delivery" BOOLEAN NOT NULL DEFAULT true,
        "fulfillment_lead_time_hours" INTEGER NULL,
        "refundable" BOOLEAN NOT NULL DEFAULT true,
        "return_window_days" INTEGER NULL,
        "tax_category" TEXT NULL,
        "requires_lot_tracking" BOOLEAN NOT NULL DEFAULT false,
        "supports_surplus_pricing" BOOLEAN NOT NULL DEFAULT false,
        "requires_producer_link" BOOLEAN NOT NULL DEFAULT false,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "product_archetype_pkey" PRIMARY KEY ("id")
      );
    `)

    // Create product_archetype_assignment table
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "product_archetype_assignment" (
        "id" TEXT NOT NULL,
        "product_id" TEXT NOT NULL UNIQUE,
        "archetype_id" TEXT NOT NULL,
        "override_refundable" BOOLEAN NULL,
        "override_return_window_days" INTEGER NULL,
        "override_fulfillment_lead_time_hours" INTEGER NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "product_archetype_assignment_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "product_archetype_assignment_archetype_fk" 
          FOREIGN KEY ("archetype_id") 
          REFERENCES "product_archetype" ("id") 
          ON DELETE RESTRICT
      );
    `)

    // Create indexes
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_product_archetype_assignment_archetype" 
      ON "product_archetype_assignment" ("archetype_id") 
      WHERE "deleted_at" IS NULL;
    `)

    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_product_archetype_assignment_product" 
      ON "product_archetype_assignment" ("product_id") 
      WHERE "deleted_at" IS NULL;
    `)

    // Seed default archetypes
    this.addSql(`
      INSERT INTO "product_archetype" (
        "id", "code", "name", "description", 
        "inventory_strategy", "requires_availability_window", "supports_preorder",
        "perishable", "perishable_shelf_days", "requires_shipping",
        "supports_pickup", "supports_delivery", "fulfillment_lead_time_hours",
        "refundable", "return_window_days", "requires_lot_tracking",
        "supports_surplus_pricing", "requires_producer_link"
      ) VALUES 
      (
        'archetype_agricultural_raw', 'AGRICULTURAL_RAW', 'Raw Agricultural Products',
        'Fresh produce, raw meat, dairy - perishable items direct from farms',
        'LOT_BASED', true, true, true, 7, true, true, true, 24,
        false, null, true, true, true
      ),
      (
        'archetype_agricultural_processed', 'AGRICULTURAL_PROCESSED', 'Processed Agricultural Products',
        'Jams, pickles, canned goods - shelf-stable farm products',
        'LOT_BASED', false, false, false, null, true, true, true, null,
        true, 30, true, false, true
      ),
      (
        'archetype_restaurant_prepared', 'RESTAURANT_PREPARED', 'Restaurant Prepared Food',
        'Ready-to-eat meals from restaurants',
        'NONE', false, false, true, 1, false, true, true, 2,
        false, null, false, false, false
      ),
      (
        'archetype_non_perishable', 'NON_PERISHABLE', 'Non-Perishable Goods',
        'Standard retail items - apparel, electronics, home goods',
        'STANDARD', false, false, false, null, true, true, true, null,
        true, 30, false, false, false
      ),
      (
        'archetype_digital', 'DIGITAL', 'Digital Products',
        'Downloads, licenses, digital access',
        'UNLIMITED', false, false, false, null, false, false, false, null,
        false, null, false, false, false
      ),
      (
        'archetype_ticket', 'TICKET', 'Event Tickets',
        'Event tickets, venue access, experiences',
        'CAPACITY', true, true, false, null, false, false, false, null,
        false, null, false, false, false
      ),
      (
        'archetype_subscription', 'SUBSCRIPTION', 'Subscription Products',
        'Recurring delivery, CSA shares, membership products',
        'STANDARD', true, true, false, null, true, true, true, null,
        true, null, false, false, false
      )
      ON CONFLICT ("code") DO NOTHING;
    `)
  }

  async down(): Promise<void> {
    this.addSql('DROP TABLE IF EXISTS "product_archetype_assignment" CASCADE;')
    this.addSql('DROP TABLE IF EXISTS "product_archetype" CASCADE;')
    this.addSql('DROP TYPE IF EXISTS "product_archetype_code_enum";')
    this.addSql('DROP TYPE IF EXISTS "inventory_strategy_enum";')
  }
}
