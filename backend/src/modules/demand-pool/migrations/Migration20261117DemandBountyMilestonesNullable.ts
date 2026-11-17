import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * SD-63 / SD-134 (5): `demand_bounty.milestones` may be NULL, as its model
 * says.
 *
 * The model declares `milestones: model.json().nullable()` with no default,
 * and `DemandPoolModuleService.addBounty` writes `input.milestones || null`.
 * For a nullable field Medusa's DML writes NULL whenever the caller gives
 * none, so the column's own DEFAULT '[]' never applies to a model write, and
 * `Migration20260207CreateDemandPool`'s NOT NULL refused every bounty created
 * without milestones. Every launch is one of those (`POST /v1/seller/launches`
 * passes `bounty_milestones`, which the panel's "Launch a Business" never
 * sends), so even with SD-63's `raw_*` columns in place no launch could
 * succeed. Readers already treat NULL as no milestones (`bounty.milestones ||
 * []` in the service).
 *
 * Dropping NOT NULL matches the model; defaulting the column could not, since
 * the model writes the NULL explicitly. The DEFAULT '[]' is kept: harmless,
 * and it still applies to an insert that names no `milestones` at all.
 */
export class Migration20261117DemandBountyMilestonesNullable extends Migration {
  override async up(): Promise<void> {
    this.addSql(`ALTER TABLE "demand_bounty" ALTER COLUMN "milestones" DROP NOT NULL;`)
  }

  /** Restores NOT NULL only when no bounty holds NULL milestones. */
  override async down(): Promise<void> {
    this.addSql(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM "demand_bounty" WHERE "milestones" IS NULL) THEN
          RAISE NOTICE 'demand_bounty: rows with NULL milestones exist; NOT NULL not restored';
        ELSE
          ALTER TABLE "demand_bounty" ALTER COLUMN "milestones" SET NOT NULL;
        END IF;
      END $$;
    `)
  }
}
