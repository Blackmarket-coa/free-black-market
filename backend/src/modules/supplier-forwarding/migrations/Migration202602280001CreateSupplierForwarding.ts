import { Migration } from "@mikro-orm/migrations"

export class Migration202602280001CreateSupplierForwarding extends Migration {
  override async up(): Promise<void> {
    this.addSql(`CREATE TYPE "supplier_profile_contact_method_enum" AS ENUM ('email', 'api', 'manual');`)
    this.addSql(`CREATE TYPE "supplier_forwarding_attempt_status_enum" AS ENUM ('pending', 'retrying', 'forwarded', 'failed', 'dead_letter');`)
    this.addSql(`CREATE TYPE "manual_fulfillment_update_status_enum" AS ENUM ('pending', 'acknowledged', 'in_progress', 'shipped', 'delivered', 'canceled');`)

    this.addSql(`CREATE TABLE IF NOT EXISTS "supplier_profile" (
      "id" TEXT NOT NULL,
      "supplier_id" TEXT NOT NULL,
      "display_name" TEXT NOT NULL,
      "contact_method" supplier_profile_contact_method_enum NOT NULL DEFAULT 'email',
      "contact_email" TEXT NULL,
      "api_base_url" TEXT NULL,
      "api_key" TEXT NULL,
      "is_active" BOOLEAN NOT NULL DEFAULT true,
      "metadata" JSONB NULL,
      "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "deleted_at" TIMESTAMPTZ NULL,
      CONSTRAINT "supplier_profile_pkey" PRIMARY KEY ("id"),
      CONSTRAINT "supplier_profile_supplier_id_unique" UNIQUE ("supplier_id")
    );`)

    this.addSql(`CREATE TABLE IF NOT EXISTS "supplier_forwarding_attempt" (
      "id" TEXT NOT NULL,
      "order_id" TEXT NOT NULL,
      "supplier_id" TEXT NOT NULL,
      "status" supplier_forwarding_attempt_status_enum NOT NULL DEFAULT 'pending',
      "retry_count" INTEGER NOT NULL DEFAULT 0,
      "last_error" TEXT NULL,
      "payload" JSONB NULL,
      "forwarded_at" TIMESTAMPTZ NULL,
      "next_retry_at" TIMESTAMPTZ NULL,
      "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "deleted_at" TIMESTAMPTZ NULL,
      CONSTRAINT "supplier_forwarding_attempt_pkey" PRIMARY KEY ("id")
    );`)

    this.addSql(`CREATE TABLE IF NOT EXISTS "manual_fulfillment_update" (
      "id" TEXT NOT NULL,
      "order_id" TEXT NOT NULL,
      "supplier_id" TEXT NOT NULL,
      "status" manual_fulfillment_update_status_enum NOT NULL DEFAULT 'pending',
      "notes" TEXT NULL,
      "source" TEXT NOT NULL DEFAULT 'manual',
      "metadata" JSONB NULL,
      "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "deleted_at" TIMESTAMPTZ NULL,
      CONSTRAINT "manual_fulfillment_update_pkey" PRIMARY KEY ("id")
    );`)

    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_supplier_forwarding_order" ON "supplier_forwarding_attempt" ("order_id") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_supplier_forwarding_status" ON "supplier_forwarding_attempt" ("status") WHERE "deleted_at" IS NULL;`)
  }

  override async down(): Promise<void> {
    this.addSql('DROP TABLE IF EXISTS "manual_fulfillment_update" CASCADE;')
    this.addSql('DROP TABLE IF EXISTS "supplier_forwarding_attempt" CASCADE;')
    this.addSql('DROP TABLE IF EXISTS "supplier_profile" CASCADE;')

    this.addSql('DROP TYPE IF EXISTS "manual_fulfillment_update_status_enum";')
    this.addSql('DROP TYPE IF EXISTS "supplier_forwarding_attempt_status_enum";')
    this.addSql('DROP TYPE IF EXISTS "supplier_profile_contact_method_enum";')
  }
}
