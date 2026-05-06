import { Migration } from "@mikro-orm/migrations"

export class Migration20260506400InitBlackstar extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "blackstar_shipment" (
        "id" text NOT NULL,
        "order_id" text NOT NULL,
        "fulfillment_id" text NULL,
        "fulfillment_node_id" text NULL,
        "pickup_point_id" text NULL,
        "vending_machine_id" text NULL,
        "external_status" text NULL,
        "metadata" jsonb NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz NULL,
        CONSTRAINT "blackstar_shipment_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_blackstar_shipment_order" ON "blackstar_shipment" ("order_id") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_blackstar_shipment_fulfillment" ON "blackstar_shipment" ("fulfillment_id") WHERE "deleted_at" IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_blackstar_shipment_node" ON "blackstar_shipment" ("fulfillment_node_id") WHERE "deleted_at" IS NULL;`)
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS "blackstar_shipment" CASCADE;`)
  }
}
