import { Migration } from "@mikro-orm/migrations"

/**
 * Growth-loop linkage on demand_post: associate a demand/need with a coalition
 * (cooperative_id), group artifacts created by one Launch run (launch_id), and
 * point a marketing bounty at the promoted product (product_id). All nullable
 * and additive — existing standalone demand-posts are unaffected.
 */
export class Migration20260603AddDemandPostLaunchLinks extends Migration {
  async up(): Promise<void> {
    this.addSql(
      `ALTER TABLE "demand_post" ADD COLUMN IF NOT EXISTS "cooperative_id" TEXT NULL;`
    )
    this.addSql(
      `ALTER TABLE "demand_post" ADD COLUMN IF NOT EXISTS "launch_id" TEXT NULL;`
    )
    this.addSql(
      `ALTER TABLE "demand_post" ADD COLUMN IF NOT EXISTS "product_id" TEXT NULL;`
    )

    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_demand_post_cooperative" ON "demand_post" ("cooperative_id") WHERE "deleted_at" IS NULL;`
    )
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_demand_post_launch" ON "demand_post" ("launch_id") WHERE "deleted_at" IS NULL;`
    )
  }

  async down(): Promise<void> {
    this.addSql(`DROP INDEX IF EXISTS "IDX_demand_post_launch";`)
    this.addSql(`DROP INDEX IF EXISTS "IDX_demand_post_cooperative";`)
    this.addSql(`ALTER TABLE "demand_post" DROP COLUMN IF EXISTS "product_id";`)
    this.addSql(`ALTER TABLE "demand_post" DROP COLUMN IF EXISTS "launch_id";`)
    this.addSql(`ALTER TABLE "demand_post" DROP COLUMN IF EXISTS "cooperative_id";`)
  }
}
