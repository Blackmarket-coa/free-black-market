import { Migration } from "@mikro-orm/migrations"

/**
 * Add a credit ceiling to vendor customer tiers.
 *
 * `payment_terms_days` has been on this table since the wholesale tier
 * shipped, and it was the only half of a credit arrangement the platform
 * modelled: a vendor could say "Net-30" but not "Net-30 up to $5,000". Terms
 * without a ceiling is an unbounded promise, and the accounts-receivable
 * module needs the ceiling to be able to refuse.
 *
 * NULL is deliberately distinct from 0 and both are meaningful:
 *
 * - NULL — this vendor does not run credit limits. No ceiling is enforced.
 * - 0    — this buyer may not carry a balance at all.
 *
 * Defaulting to 0 would have silently switched every existing wholesale tier
 * from "no limit" to "no credit", which is why the column is nullable and the
 * default is NULL. `resolveCreditLimitCents` reads it that way.
 */
export class Migration20260902000100AddTierCreditLimit extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      ALTER TABLE "vendor_customer_tier"
        ADD COLUMN IF NOT EXISTS "credit_limit_cents" INTEGER NULL;
    `)
    this.addSql(`
      ALTER TABLE "vendor_customer_tier"
        DROP CONSTRAINT IF EXISTS "CK_vct_credit_limit";
    `)
    this.addSql(`
      ALTER TABLE "vendor_customer_tier"
        ADD CONSTRAINT "CK_vct_credit_limit"
        CHECK ("credit_limit_cents" IS NULL OR "credit_limit_cents" >= 0);
    `)
  }

  async down(): Promise<void> {
    this.addSql(`
      ALTER TABLE "vendor_customer_tier"
        DROP CONSTRAINT IF EXISTS "CK_vct_credit_limit";
    `)
    this.addSql(`
      ALTER TABLE "vendor_customer_tier"
        DROP COLUMN IF EXISTS "credit_limit_cents";
    `)
  }
}
