import { Migration } from "@mikro-orm/migrations";

/**
 * Migration: Add `node_operator_opt_in` to seller_metadata
 *
 * Whether this seller has asked to run a Blackstar logistics node.
 *
 * Provisioning was gated on `vendor_type === "logistics"`, which is the wrong
 * shape for the question: vendor_type is a single archetype chosen once at
 * registration, so a kitchen that also drives deliveries had to misrepresent
 * what it sells to carry them, and a seller who decided later could not opt in
 * at all. This is a flag, set from the onboarding survey or from settings
 * afterwards, and it is what now decides who is handed node credentials.
 *
 * Defaults false: holding logistics credentials is opt-in, never a side effect
 * of being approved as a seller.
 */
export class Migration20260917AddNodeOperatorOptIn extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      ALTER TABLE "seller_metadata"
      ADD COLUMN IF NOT EXISTS "node_operator_opt_in" BOOLEAN NOT NULL DEFAULT false;
    `);
  }

  async down(): Promise<void> {
    this.addSql(`
      ALTER TABLE "seller_metadata"
      DROP COLUMN IF EXISTS "node_operator_opt_in";
    `);
  }
}
