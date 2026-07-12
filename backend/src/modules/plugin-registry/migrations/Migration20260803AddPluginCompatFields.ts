import { Migration } from "@mikro-orm/migrations"

export class Migration20260803AddPluginCompatFields extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      ALTER TABLE "plugin_listing"
        ADD COLUMN IF NOT EXISTS "min_host_version" TEXT NULL,
        ADD COLUMN IF NOT EXISTS "max_host_version" TEXT NULL;
    `)
  }

  async down(): Promise<void> {
    this.addSql(`
      ALTER TABLE "plugin_listing"
        DROP COLUMN IF EXISTS "min_host_version",
        DROP COLUMN IF EXISTS "max_host_version";
    `)
  }
}
