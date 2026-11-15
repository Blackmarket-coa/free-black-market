import { Migration } from "@mikro-orm/migrations"

/**
 * Add the `raw_<field>` companions the garden module's hand-written create
 * migration never made.
 *
 * `model.bigNumber()` persists a NUMERIC column plus a `raw_<field>` JSONB
 * companion that the generated CRUD writes on every insert.
 * `Migration20260203CreateGarden` created only the NUMERIC halves, so on a
 * database built from the migrations every insert into these tables fails —
 * observed: `column "raw_voting_power" of relation "garden_membership" does
 * not exist`. Nobody could join a garden (`POST /store/gardens/:id/members`),
 * add a plot, or record a soil zone. It is the SD-39 / SD-50 class.
 *
 * It matters now because `POST /store/gardens` records the creator as the
 * garden's first organizer, and that membership is what authorizes every
 * later garden write; without these columns no garden could be created at all.
 *
 * Nullable, so it is safe on tables that already have rows (there are none
 * that could have been written); the backfill derives each companion from the
 * numeric value it mirrors and is a no-op otherwise. Same shape as
 * `creator-attribution`'s `Migration20260904AddRawBigNumberColumns`.
 */
const RAW_COMPANIONS: Array<[table: string, field: string]> = [
  ["garden_membership", "volunteer_hours_balance"],
  ["garden_membership", "harvest_credits_balance"],
  ["garden_membership", "investment_balance"],
  ["garden_membership", "voting_power"],
  ["garden_plot", "season_fee"],
  ["garden_soil_zone", "ph_level"],
  ["garden_soil_zone", "organic_matter_percent"],
]

export class Migration20261115AddRawBigNumberColumns extends Migration {
  async up(): Promise<void> {
    for (const [table, field] of RAW_COMPANIONS) {
      this.addSql(
        `ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "raw_${field}" JSONB NULL;`
      )
      this.addSql(`
        UPDATE "${table}"
           SET "raw_${field}" = jsonb_build_object('value', "${field}"::text, 'precision', 20)
         WHERE "raw_${field}" IS NULL AND "${field}" IS NOT NULL;
      `)
    }
  }

  async down(): Promise<void> {
    for (const [table, field] of RAW_COMPANIONS) {
      this.addSql(`ALTER TABLE "${table}" DROP COLUMN IF EXISTS "raw_${field}";`)
    }
  }
}
