import { Migration } from "@mikro-orm/migrations"

/**
 * Add marketplace-layer product archetype enum values.
 *
 * PostgreSQL requires enum values to be committed before they can be used.
 * Seeding is done in Migration20260506001SeedMarketplaceArchetypes.
 */
export class Migration20260506000AddMarketplaceArchetypeEnums extends Migration {
  isTransactional(): boolean {
    return false
  }

  async up(): Promise<void> {
    this.addSql(`
      DO $$ BEGIN
        ALTER TYPE "product_archetype_code_enum" ADD VALUE IF NOT EXISTS 'SERVICE';
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)
    this.addSql(`
      DO $$ BEGIN
        ALTER TYPE "product_archetype_code_enum" ADD VALUE IF NOT EXISTS 'PLUGIN';
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)
    this.addSql(`
      DO $$ BEGIN
        ALTER TYPE "product_archetype_code_enum" ADD VALUE IF NOT EXISTS 'THEME';
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)
    this.addSql(`
      DO $$ BEGIN
        ALTER TYPE "product_archetype_code_enum" ADD VALUE IF NOT EXISTS 'EMOJI_PACK';
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)
    this.addSql(`
      DO $$ BEGIN
        ALTER TYPE "product_archetype_code_enum" ADD VALUE IF NOT EXISTS 'ACCESS_PASS';
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)
  }

  async down(): Promise<void> {
    // Postgres cannot remove enum values without recreating the type. No-op by design.
  }
}
