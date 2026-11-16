import { Migration } from "@medusajs/framework/mikro-orm/migrations"

const MARKER = "Migration20261115210000AddUniqueBallotIndex"

/**
 * One live ballot per member per proposal, enforced by the database.
 *
 * `POST /store/proposals/:id/votes` checked "already voted" with a read and
 * then inserted, and `garden_vote` had no unique index, so concurrent requests
 * from one member each wrote a ballot (Postgres: 6 concurrent POSTs, 4 to 6
 * ballots). The index makes the second insert fail; the route answers it with
 * the same 400 as the sequential case (`GovernanceModuleService.castBallot`).
 *
 * A plain CREATE UNIQUE INDEX would fail on any duplicate already written,
 * so the duplicates go first:
 *
 * 1. Every live ballot after a member's first on a proposal (ordered by
 *    `voted_at`, `created_at`, `id`) is soft-deleted, with
 *    `metadata.soft_deleted_by` naming this migration. The rows stay, so what
 *    was removed can be listed and restored.
 * 2. The tally of each proposal that had a duplicate is recomputed from its
 *    remaining live ballots. Those tallies are wrong in an unknown direction:
 *    a duplicate either added its weight a second time or, in the race that
 *    wrote it, overwrote another vote's increment. Proposals without a
 *    duplicate are not touched, and no status or result field is.
 * 3. The partial unique index, matching the model's.
 *
 * Steps 1 and 2 are no-ops on a table with no duplicates.
 */
export class Migration20261115210000AddUniqueBallotIndex extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      UPDATE "garden_vote" AS v
         SET "deleted_at" = now(),
             "updated_at" = now(),
             "metadata" = COALESCE(v."metadata", '{}'::jsonb)
               || jsonb_build_object('soft_deleted_by', '${MARKER}', 'reason', 'duplicate ballot')
        FROM (
          SELECT "id",
                 row_number() OVER (
                   PARTITION BY "proposal_id", "customer_id"
                   ORDER BY "voted_at", "created_at", "id"
                 ) AS rn
            FROM "garden_vote"
           WHERE "deleted_at" IS NULL
        ) AS ranked
       WHERE v."id" = ranked."id" AND ranked.rn > 1;
    `)

    this.addSql(`
      UPDATE "garden_proposal" AS p
         SET "votes_for" = t.votes_for,
             "raw_votes_for" = jsonb_build_object('value', trim_scale(t.votes_for)::text, 'precision', 20),
             "votes_against" = t.votes_against,
             "raw_votes_against" = jsonb_build_object('value', trim_scale(t.votes_against)::text, 'precision', 20),
             "votes_abstain" = t.votes_abstain,
             "raw_votes_abstain" = jsonb_build_object('value', trim_scale(t.votes_abstain)::text, 'precision', 20),
             "total_voting_power" = t.total_voting_power,
             "raw_total_voting_power" = jsonb_build_object('value', trim_scale(t.total_voting_power)::text, 'precision', 20),
             "unique_voters" = t.unique_voters,
             "updated_at" = now()
        FROM (
          SELECT "proposal_id",
                 COALESCE(SUM("voting_power") FILTER (WHERE "vote" = 'for'), 0) AS votes_for,
                 COALESCE(SUM("voting_power") FILTER (WHERE "vote" = 'against'), 0) AS votes_against,
                 COALESCE(SUM("voting_power") FILTER (WHERE "vote" = 'abstain'), 0) AS votes_abstain,
                 COALESCE(SUM("voting_power"), 0) AS total_voting_power,
                 COUNT(DISTINCT "customer_id")::int AS unique_voters
            FROM "garden_vote"
           WHERE "deleted_at" IS NULL
             AND "proposal_id" IN (
               SELECT "proposal_id" FROM "garden_vote" WHERE "metadata"->>'soft_deleted_by' = '${MARKER}'
             )
           GROUP BY "proposal_id"
        ) AS t
       WHERE p."id" = t."proposal_id";
    `)

    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_garden_vote_proposal_customer_unique"
          ON "garden_vote" ("proposal_id", "customer_id")
       WHERE "deleted_at" IS NULL;
    `)
  }

  override async down(): Promise<void> {
    // The soft-deleted duplicates are left as they are: restoring them would
    // put a member's second ballot back.
    this.addSql(`DROP INDEX IF EXISTS "IDX_garden_vote_proposal_customer_unique";`)
  }
}
