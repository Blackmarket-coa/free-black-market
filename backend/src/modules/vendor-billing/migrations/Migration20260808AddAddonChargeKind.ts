import { Migration } from "@mikro-orm/migrations"

/**
 * Allow `addon` as a vendor-charge kind.
 *
 * This is the payoff of `Migration20260806CreateVendorCharge` choosing
 * TEXT + CHECK over a Postgres enum: adding a kind is one ordinary
 * drop-and-recreate of the constraint, usable in the same batch, with no
 * enum-value transaction trap.
 *
 * The recreate widens the allowed set, so every existing row already
 * satisfies the new constraint and the ALTER takes no table rewrite.
 */
export class Migration20260808AddAddonChargeKind extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      ALTER TABLE "vendor_charge"
        DROP CONSTRAINT IF EXISTS "CK_vendor_charge_kind";
    `)
    this.addSql(`
      ALTER TABLE "vendor_charge"
        ADD CONSTRAINT "CK_vendor_charge_kind" CHECK (
          "kind" IN ('plan', 'promotion', 'addon', 'usage', 'manual')
        );
    `)
  }

  async down(): Promise<void> {
    // Narrowing back requires no `addon` rows to exist; delete or re-kind them
    // first if rolling back after real use.
    this.addSql(`
      ALTER TABLE "vendor_charge"
        DROP CONSTRAINT IF EXISTS "CK_vendor_charge_kind";
    `)
    this.addSql(`
      ALTER TABLE "vendor_charge"
        ADD CONSTRAINT "CK_vendor_charge_kind" CHECK (
          "kind" IN ('plan', 'promotion', 'usage', 'manual')
        );
    `)
  }
}
