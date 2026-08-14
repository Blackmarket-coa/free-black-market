import { Migration } from "@mikro-orm/migrations"

export class Migration20260813500BridgeCredentials extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "blackstar_bridge_credential" (
        "id" text NOT NULL,
        "key_id" text NOT NULL,
        "label" text NOT NULL,
        "secret" text NOT NULL,
        "status" text NOT NULL DEFAULT 'active',
        "last_used_at" timestamptz NULL,
        "revoked_at" timestamptz NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz NULL,
        CONSTRAINT "blackstar_bridge_credential_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_blackstar_bridge_credential_key" ON "blackstar_bridge_credential" ("key_id") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_blackstar_bridge_credential_status" ON "blackstar_bridge_credential" ("status") WHERE "deleted_at" IS NULL;`)
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS "blackstar_bridge_credential" CASCADE;`)
  }
}
