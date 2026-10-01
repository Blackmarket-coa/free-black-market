import { Migration } from "@mikro-orm/migrations"

/**
 * The credential a seller's Blackstar node signs with.
 *
 * FBM mints this and sends it over the bridge when a seller opts into running a
 * node; it was previously generated, put on the wire and forgotten, so no
 * operator could ever be told what their own credential was. Stored encrypted,
 * displayed once at issue, and rotated rather than recovered.
 */
export class Migration20260917NodeOperatorCredentials extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "blackstar_node_operator_credential" (
        "id" text NOT NULL,
        "seller_id" text NOT NULL,
        "key_id" text NOT NULL,
        "secret" text NOT NULL,
        "status" text NOT NULL DEFAULT 'active',
        "revoked_at" timestamptz NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz NULL,
        CONSTRAINT "blackstar_node_operator_credential_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_blackstar_node_operator_credential_key" ON "blackstar_node_operator_credential" ("key_id") WHERE "deleted_at" IS NULL;`
    )
    // One live credential per seller: rotation revokes before it issues, so an
    // operator cannot accumulate active secrets they have lost track of.
    this.addSql(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_blackstar_node_operator_credential_active_seller" ON "blackstar_node_operator_credential" ("seller_id") WHERE "deleted_at" IS NULL AND "revoked_at" IS NULL AND "status" = 'active';`
    )
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS "blackstar_node_operator_credential" CASCADE;`)
  }
}
