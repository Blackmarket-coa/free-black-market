import { Migration } from "@mikro-orm/migrations"

export class Migration20260304123000CollectiveCampaignPoUniqueness extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_collective_po_campaign_material"
      ON "collective_purchase_order" ("campaign_id", "material_line_item_id")
      WHERE "deleted_at" IS NULL AND "material_line_item_id" IS NOT NULL;
    `)
  }
}
