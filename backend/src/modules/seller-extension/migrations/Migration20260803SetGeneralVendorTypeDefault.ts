import { Migration } from "@mikro-orm/migrations"

/**
 * Make `general` the column default for `seller_metadata.vendor_type`.
 *
 * Split from `Migration20260802AddGeneralVendorType` because Postgres rejects
 * using an enum label added in the same (still-open) transaction — see that
 * migration's note. By the time this runs, `general` is committed.
 *
 * The previous default was `producer`, set by
 * `Migration20260114FixVendorTypeEnum`. That default reflected FBM's
 * food-system origins; `general` is the correct neutral default now that the
 * vendor portal is offered to businesses outside that footprint. Existing rows
 * are untouched — this only affects inserts that omit `vendor_type`.
 */
export class Migration20260803SetGeneralVendorTypeDefault extends Migration {
  async up(): Promise<void> {
    this.addSql(
      `ALTER TABLE "seller_metadata" ALTER COLUMN "vendor_type" SET DEFAULT 'general';`
    )
  }

  async down(): Promise<void> {
    this.addSql(
      `ALTER TABLE "seller_metadata" ALTER COLUMN "vendor_type" SET DEFAULT 'producer';`
    )
  }
}
