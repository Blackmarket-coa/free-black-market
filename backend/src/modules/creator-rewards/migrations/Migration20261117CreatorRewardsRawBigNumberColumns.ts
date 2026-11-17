import { Migration } from "@medusajs/framework/mikro-orm/migrations"
import {
  addRawBigNumberColumnsSql,
  dropRawBigNumberColumnsSql,
  type RawCompanion,
} from "../../../lib/raw-big-number-columns"

/**
 * SD-63: add the `raw_<field>` companions of the creator-rewards module's
 * `model.bigNumber()` fields, which its create migrations never made.
 *
 * Medusa's DML writes a JSONB `raw_<field>` beside every bigNumber's NUMERIC
 * column on each insert, so on a database built from the migrations every
 * insert into `engagement_snapshot`, `reward_payout`, `reward_pool` failed
 * with `column "raw_<field>" of relation "<table>" does not exist`. No
 * engagement snapshot, reward pool or reward payout could be written; `POST
 * /v1/seller/programs/:id/reward-pools` failed before it reached the ledger.
 *
 * Shapes follow each field's declaration (nullable, required, or required
 * with a default), as Medusa's own migrations give them. Existing rows are
 * backfilled from the NUMERIC column in Medusa's raw format before any NOT
 * NULL, and the migration is a no-op on a schema that already has the
 * columns: see `lib/raw-big-number-columns.ts`. Measured, and kept from
 * coming back, by `integration-tests/http/module-schema-drift.spec.ts`.
 */
const COLUMNS: RawCompanion[] = [
  ["engagement_snapshot", "views", { default: "0" }],
  ["engagement_snapshot", "qualified_views", { default: "0" }],
  ["engagement_snapshot", "likes", { default: "0" }],
  ["engagement_snapshot", "shares", { default: "0" }],
  ["engagement_snapshot", "comments", { default: "0" }],
  ["engagement_snapshot", "saves", { default: "0" }],
  ["engagement_snapshot", "watch_time_seconds", { default: "0" }],
  ["reward_payout", "qualified_views", { default: "0" }],
  ["reward_payout", "amount_cents", "required"],
  ["reward_pool", "total_cents", "required"],
]

export class Migration20261117CreatorRewardsRawBigNumberColumns extends Migration {
  override async up(): Promise<void> {
    for (const sql of addRawBigNumberColumnsSql(COLUMNS)) this.addSql(sql)
  }

  override async down(): Promise<void> {
    for (const sql of dropRawBigNumberColumnsSql(COLUMNS)) this.addSql(sql)
  }
}
