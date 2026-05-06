import { Migration } from "@mikro-orm/migrations"

/**
 * Seed marketplace-layer product archetypes.
 *
 * Runs after Migration20260506000AddMarketplaceArchetypeEnums commits the enum
 * values. Idempotent via ON CONFLICT DO NOTHING.
 *
 * Archetypes added:
 * - SERVICE:     vendor services (consulting, coaching, design)
 * - PLUGIN:      software plugins for the BMC ecosystem
 * - THEME:       storefront/UI themes
 * - EMOJI_PACK:  emoji packs (e.g. Blackout custom packs)
 * - ACCESS_PASS: feature/community access, entitlement-driven
 */
export class Migration20260506001SeedMarketplaceArchetypes extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      INSERT INTO "product_archetype" (
        "id", "code", "name", "description",
        "inventory_strategy", "requires_availability_window", "supports_preorder",
        "perishable", "perishable_shelf_days", "requires_shipping",
        "supports_pickup", "supports_delivery", "fulfillment_lead_time_hours",
        "refundable", "return_window_days", "requires_lot_tracking",
        "supports_surplus_pricing", "requires_producer_link",
        "metadata"
      ) VALUES
      (
        'archetype_service', 'SERVICE', 'Service',
        'Vendor services such as consulting, coaching, or design work',
        'NONE', true, false, false, null, false, false, false, null,
        true, 7, false, false, false,
        '{"scheduling_required": true, "marketplace_layer": true}'::jsonb
      ),
      (
        'archetype_plugin', 'PLUGIN', 'Plugin',
        'Software plugin distributed via the BMC plugin marketplace',
        'UNLIMITED', false, false, false, null, false, false, true, null,
        true, 14, false, false, false,
        '{"digital_delivery": true, "marketplace_layer": true, "supports_versioning": true}'::jsonb
      ),
      (
        'archetype_theme', 'THEME', 'Theme',
        'Storefront or UI theme distributed via the BMC marketplace',
        'UNLIMITED', false, false, false, null, false, false, true, null,
        true, 14, false, false, false,
        '{"digital_delivery": true, "marketplace_layer": true}'::jsonb
      ),
      (
        'archetype_emoji_pack', 'EMOJI_PACK', 'Emoji Pack',
        'Custom emoji packs (e.g. for Blackout)',
        'UNLIMITED', false, false, false, null, false, false, true, null,
        false, null, false, false, false,
        '{"digital_delivery": true, "marketplace_layer": true}'::jsonb
      ),
      (
        'archetype_access_pass', 'ACCESS_PASS', 'Access Pass',
        'Time-bound or perpetual feature access; grants entitlements on purchase',
        'UNLIMITED', false, false, false, null, false, false, true, null,
        false, null, false, false, false,
        '{"grants_entitlement": true, "marketplace_layer": true}'::jsonb
      )
      ON CONFLICT ("code") DO NOTHING;
    `)
  }

  async down(): Promise<void> {
    this.addSql(`
      DELETE FROM "product_archetype"
      WHERE "code" IN ('SERVICE', 'PLUGIN', 'THEME', 'EMOJI_PACK', 'ACCESS_PASS');
    `)
  }
}
