import { Migration } from "@mikro-orm/migrations"

/**
 * Phase 6 — barter as a fulfilment path for demand posts and bounties.
 *
 * `offering` and `wanting` are free text rather than foreign keys or a
 * taxonomy. Barter is precisely the domain where a category tree fails: the
 * point is that someone can offer three hours of plumbing for a chest freezer.
 * The table records an agreement; it does not try to classify it.
 *
 * TEXT + CHECK for the status enum, matching what Medusa's `model.enum()`
 * generates — `bounty_status_enum` diverging from that already cost a harness
 * workaround in `milestone-cas.integration.spec.ts`.
 */
export class Migration20260806CreateBarter extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "barter_proposal" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "demand_post_id" TEXT NULL,
        "bounty_id" TEXT NULL,
        "proposer_id" TEXT NOT NULL,
        "offering" TEXT NOT NULL,
        "wanting" TEXT NOT NULL,
        "estimated_hours" DOUBLE PRECISION NULL,
        "status" TEXT NOT NULL DEFAULT 'PROPOSED'
          CHECK ("status" IN ('PROPOSED','ACCEPTED','DECLINED','COMPLETED','WITHDRAWN')),
        "accepted_by" TEXT NULL,
        "accepted_at" TIMESTAMPTZ NULL,
        "completed_at" TIMESTAMPTZ NULL,
        "ledger_entry_id" TEXT NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "deleted_at" TIMESTAMPTZ NULL,
        -- Exactly one target. A proposal attached to both would be ambiguous
        -- about who is entitled to accept it.
        CONSTRAINT "barter_proposal_one_target" CHECK (
          ("demand_post_id" IS NOT NULL) <> ("bounty_id" IS NOT NULL)
        )
      );
    `)
    for (const col of ["demand_post_id", "bounty_id", "proposer_id", "status"]) {
      this.addSql(
        `CREATE INDEX IF NOT EXISTS "IDX_barter_proposal_${col}" ON "barter_proposal" ("${col}") WHERE "deleted_at" IS NULL;`
      )
    }
  }

  async down(): Promise<void> {
    this.addSql('DROP TABLE IF EXISTS "barter_proposal";')
  }
}
