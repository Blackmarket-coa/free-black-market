import { Migration } from "@mikro-orm/migrations"

/**
 * Create the two model-backed tables that the payout-breakdown module defines
 * but never had a migration for: `payout_config` and `seller_payout_settings`
 * (finding B-money-1). Without them, `getEffectivePlatformFee` throws on the
 * first `SELECT ... FROM "payout_config"`, and because the order-payment
 * subscriber swallows that error the double-entry ledger accrual never records.
 *
 * Columns mirror `models/payout-config.ts` and `models/seller-payout-settings.ts`.
 * `model.number()` fields use REAL so decimal percentages (e.g. 2.9) fit and are
 * returned as JS numbers by node-postgres.
 */
export class Migration20260706000001CreatePayoutConfigAndSellerSettings extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "payout_config" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "name" TEXT NOT NULL,
        "is_default" BOOLEAN NOT NULL DEFAULT false,
        "platform_fee_percent" REAL NOT NULL DEFAULT 3,
        "platform_fee_min" REAL NOT NULL DEFAULT 0,
        "platform_fee_max" REAL NOT NULL DEFAULT 0,
        "payment_processing_percent" REAL NOT NULL DEFAULT 2.9,
        "payment_processing_fixed" REAL NOT NULL DEFAULT 30,
        "community_fund_percent" REAL NOT NULL DEFAULT 0,
        "community_fund_description" TEXT,
        "plugin_developer_percent" REAL NOT NULL DEFAULT 0,
        "referral_percent" REAL NOT NULL DEFAULT 0,
        "min_payout_threshold" REAL NOT NULL DEFAULT 0,
        "payout_frequency_days" REAL NOT NULL DEFAULT 7,
        "payout_delay_days" REAL NOT NULL DEFAULT 2,
        "show_breakdown_to_customers" BOOLEAN NOT NULL DEFAULT true,
        "show_percentages" BOOLEAN NOT NULL DEFAULT true,
        "fee_labels" JSONB,
        "metadata" JSONB,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "deleted_at" TIMESTAMPTZ
      );
    `)

    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_payout_config_name_unique"
        ON "payout_config" ("name")
        WHERE "deleted_at" IS NULL;
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_payout_config_default"
        ON "payout_config" ("is_default")
        WHERE "deleted_at" IS NULL;
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_payout_config_deleted_at"
        ON "payout_config" ("deleted_at") WHERE "deleted_at" IS NULL;
    `)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "seller_payout_settings" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "seller_id" TEXT NOT NULL,
        "custom_platform_fee_percent" REAL,
        "fee_reduction_reason" TEXT,
        "fee_reduction_expires_at" TIMESTAMPTZ,
        "payout_method" TEXT NOT NULL DEFAULT 'STRIPE'
          CHECK ("payout_method" IN ('STRIPE','BANK_TRANSFER','CHECK','CRYPTO','HAWALA')),
        "custom_payout_frequency_days" REAL,
        "instant_payout_enabled" BOOLEAN NOT NULL DEFAULT false,
        "show_breakdown" BOOLEAN NOT NULL DEFAULT true,
        "transparency_message" TEXT,
        "additional_community_contribution" REAL NOT NULL DEFAULT 0,
        "community_contribution_message" TEXT,
        "metadata" JSONB,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "deleted_at" TIMESTAMPTZ
      );
    `)

    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_seller_payout_settings_seller_id_unique"
        ON "seller_payout_settings" ("seller_id")
        WHERE "deleted_at" IS NULL;
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_seller_payout_settings_deleted_at"
        ON "seller_payout_settings" ("deleted_at") WHERE "deleted_at" IS NULL;
    `)
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS "seller_payout_settings";`)
    this.addSql(`DROP TABLE IF EXISTS "payout_config";`)
  }
}
