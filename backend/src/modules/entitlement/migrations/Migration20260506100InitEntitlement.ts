import { Migration } from "@mikro-orm/migrations"

export class Migration20260506100InitEntitlement extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "entitlement" (
        "id" text NOT NULL,
        "customer_id" text NULL,
        "customer_external_id" text NULL,
        "product_id" text NULL,
        "variant_id" text NULL,
        "kind" text CHECK ("kind" IN ('digital','access_pass','plugin','theme','emoji_pack','service','other')) NOT NULL DEFAULT 'other',
        "feature_key" text NOT NULL,
        "status" text CHECK ("status" IN ('active','pending','expired','revoked')) NOT NULL DEFAULT 'active',
        "source" text CHECK ("source" IN ('order','subscription','manual','external')) NOT NULL DEFAULT 'order',
        "source_order_id" text NULL,
        "source_subscription_id" text NULL,
        "granted_at" timestamptz NOT NULL,
        "expires_at" timestamptz NULL,
        "revoked_at" timestamptz NULL,
        "revoked_reason" text NULL,
        "metadata" jsonb NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz NULL,
        CONSTRAINT "entitlement_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_entitlement_customer_status" ON "entitlement" ("customer_id","status") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_entitlement_external_feature" ON "entitlement" ("customer_external_id","feature_key") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_entitlement_expires_at" ON "entitlement" ("expires_at") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_entitlement_source_order_product" ON "entitlement" ("source_order_id","product_id") WHERE "source_order_id" IS NOT NULL AND "product_id" IS NOT NULL AND "deleted_at" IS NULL;`)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "entitlement_grant_rule" (
        "id" text NOT NULL,
        "seller_id" text NULL,
        "product_id" text NULL,
        "variant_id" text NULL,
        "feature_key" text NOT NULL,
        "kind" text CHECK ("kind" IN ('digital','access_pass','plugin','theme','emoji_pack','service','other')) NOT NULL DEFAULT 'other',
        "duration_days" integer NULL,
        "enabled" boolean NOT NULL DEFAULT true,
        "metadata" jsonb NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz NULL,
        CONSTRAINT "entitlement_grant_rule_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_entitlement_grant_rule_product" ON "entitlement_grant_rule" ("product_id") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_entitlement_grant_rule_variant" ON "entitlement_grant_rule" ("variant_id") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_entitlement_grant_rule_seller" ON "entitlement_grant_rule" ("seller_id") WHERE "deleted_at" IS NULL;`)
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS "entitlement_grant_rule" CASCADE;`)
    this.addSql(`DROP TABLE IF EXISTS "entitlement" CASCADE;`)
  }
}
