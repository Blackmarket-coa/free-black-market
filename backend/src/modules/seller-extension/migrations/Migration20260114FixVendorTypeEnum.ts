import { Migration } from "@mikro-orm/migrations"

/**
 * Migration: Normalize vendor_type values and recreate vendor_type_enum
 *
 * - Converts any legacy uppercase enum labels (FARM, DISTRIBUTOR, CREATOR, RETAIL)
 *   to the canonical lowercase set used across the codebase
 *   (producer, garden, kitchen, maker, restaurant, mutual_aid).
 * - Recreates the Postgres enum type `vendor_type_enum` with the canonical values
 *   and converts the `vendor_type` column back to that enum.
 */
export class Migration20260114FixVendorTypeEnum extends Migration {
  async up(): Promise<void> {
    // Ensure column is text so we can safely rewrite values regardless of current enum shape
    this.addSql('ALTER TABLE "seller_metadata" ALTER COLUMN "vendor_type" TYPE TEXT USING "vendor_type"::text;')

    // Map legacy/upper-case values to canonical lowercase values.
    // Leave already-canonical values unchanged (use lower()).
    this.addSql(`
      UPDATE "seller_metadata"
      SET "vendor_type" = CASE
        WHEN UPPER("vendor_type") = 'FARM' THEN 'producer'
        WHEN UPPER("vendor_type") = 'DISTRIBUTOR' THEN 'producer'
        WHEN UPPER("vendor_type") = 'CREATOR' THEN 'maker'
        WHEN UPPER("vendor_type") = 'RETAIL' THEN 'maker'
        ELSE lower("vendor_type")
      END;
    `)

    // Drop any prior enum and recreate with canonical entries (including 'kitchen')
    this.addSql('DROP TYPE IF EXISTS "vendor_type_enum" CASCADE;')
    this.addSql(`
      CREATE TYPE "vendor_type_enum" AS ENUM (
        'producer',
        'garden',
        'kitchen',
        'maker',
        'restaurant',
        'mutual_aid'
      );
    `)

    // Convert column back to enum type
    this.addSql('ALTER TABLE "seller_metadata" ALTER COLUMN "vendor_type" TYPE vendor_type_enum USING "vendor_type"::vendor_type_enum;')
    this.addSql("ALTER TABLE \"seller_metadata\" ALTER COLUMN \"vendor_type\" SET DEFAULT 'producer';")
  }

  async down(): Promise<void> {
    // Revert: convert to text and (best-effort) map canonical values back to a legacy set.
    this.addSql('ALTER TABLE "seller_metadata" ALTER COLUMN "vendor_type" TYPE TEXT USING "vendor_type"::text;')

    // Map canonical values back to the older legacy tokens where appropriate
    this.addSql(`
      UPDATE "seller_metadata"
      SET "vendor_type" = CASE
        WHEN "vendor_type" = 'producer' THEN 'FARM'
        WHEN "vendor_type" = 'maker' THEN 'RETAIL'
        WHEN "vendor_type" = 'restaurant' THEN 'RESTAURANT'
        WHEN "vendor_type" = 'garden' THEN 'GARDEN'
        WHEN "vendor_type" = 'mutual_aid' THEN 'MUTUAL_AID'
        WHEN "vendor_type" = 'kitchen' THEN 'KITCHEN'
        ELSE upper("vendor_type")
      END;
    `)

    // Recreate the older enum tokens to match legacy migrations (best-effort)
    this.addSql('DROP TYPE IF EXISTS "vendor_type_enum" CASCADE;')
    this.addSql(`
      CREATE TYPE "vendor_type_enum" AS ENUM (
        'FARM',
        'RESTAURANT',
        'DISTRIBUTOR',
        'CREATOR',
        'RETAIL'
      );
    `)

    // Convert the column back to the legacy enum (if desired by rollback)
    this.addSql('ALTER TABLE "seller_metadata" ALTER COLUMN "vendor_type" TYPE vendor_type_enum USING "vendor_type"::vendor_type_enum;')
    this.addSql('ALTER TABLE "seller_metadata" ALTER COLUMN "vendor_type" SET DEFAULT "RETAIL";')
  }
}
