import { Migration } from "@mikro-orm/migrations"

/**
 * Let a quote line say when it ships.
 *
 * A quote for 500 units that cannot state a lead time is half a quote: the
 * buyer agrees a price and then learns the delivery date in a message thread.
 * Tier 2.5 (production capacity and lead time) wanted a per-variant field that
 * auto-fills this; the audit concluded a vendor-entered value per line is the
 * honest first step, because three per-product lead-time fields already exist
 * in the repo and enforce nothing, and a fourth unwired one would repeat that.
 * This column is what the vendor types. The auto-default can land later and
 * fill it; nothing here assumes it.
 *
 * Nullable: "no lead time stated" is a real answer (in-stock, ships now) and
 * must stay distinguishable from 0.
 */
export class Migration20260903000100AddQuoteLineLeadTime extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      ALTER TABLE "quote_line"
        ADD COLUMN IF NOT EXISTS "lead_time_days" INTEGER NULL;
    `)
    this.addSql(`
      ALTER TABLE "quote_line"
        DROP CONSTRAINT IF EXISTS "CK_quote_line_lead_time";
    `)
    this.addSql(`
      ALTER TABLE "quote_line"
        ADD CONSTRAINT "CK_quote_line_lead_time"
        CHECK ("lead_time_days" IS NULL OR "lead_time_days" >= 0);
    `)
  }

  async down(): Promise<void> {
    this.addSql(`ALTER TABLE "quote_line" DROP CONSTRAINT IF EXISTS "CK_quote_line_lead_time";`)
    this.addSql(`ALTER TABLE "quote_line" DROP COLUMN IF EXISTS "lead_time_days";`)
  }
}
