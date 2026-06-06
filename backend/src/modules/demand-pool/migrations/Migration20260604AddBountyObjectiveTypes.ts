import { Migration } from "@mikro-orm/migrations"

/**
 * Add producer→creator marketing bounty objective enum values
 * (CREATOR_NEEDED, MARKETING_NEEDED, PHOTOGRAPHY_NEEDED) to
 * "bounty_objective_enum".
 *
 * PostgreSQL ADD VALUE IF NOT EXISTS is idempotent and a no-op on a DB that
 * already has them. Mirrors the idiom in
 * product-archetype/Migration20260506000AddMarketplaceArchetypeEnums.
 */
export class Migration20260604AddBountyObjectiveTypes extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      DO $$ BEGIN
        ALTER TYPE "bounty_objective_enum" ADD VALUE IF NOT EXISTS 'CREATOR_NEEDED';
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)
    this.addSql(`
      DO $$ BEGIN
        ALTER TYPE "bounty_objective_enum" ADD VALUE IF NOT EXISTS 'MARKETING_NEEDED';
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)
    this.addSql(`
      DO $$ BEGIN
        ALTER TYPE "bounty_objective_enum" ADD VALUE IF NOT EXISTS 'PHOTOGRAPHY_NEEDED';
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)
  }

  // Down is intentionally a no-op: PostgreSQL cannot drop a single enum value
  // without rebuilding the type, and these additions are backward-compatible.
  async down(): Promise<void> {}
}
