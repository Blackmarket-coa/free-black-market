import { Migration } from "@medusajs/framework/mikro-orm/migrations"
import { createLogger } from "../../../shared/logger"

const MARKER = "Migration20261116090000RecomputeActiveProposalTallies"

const log = createLogger("Governance")

/**
 * Each live proposal's tally as `GovernanceModuleService.castBallot` would
 * have written it from the ballots it holds now. `castBallot` adds a ballot's
 * `voting_power` to its choice's column and to `total_voting_power`, and 1 to
 * `unique_voters`, per ballot written; so the sums are over the ballots'
 * stored `voting_power` (whatever weighting the route applied when it was
 * cast, `equal_vote` gardens included) and the voter count is the number of
 * live ballots, one per member under `IDX_garden_vote_proposal_customer_unique`.
 * A proposal with no live ballot counts zero.
 */
const LIVE_TALLY = `
  SELECT p."id",
         COALESCE(SUM(v."voting_power") FILTER (WHERE v."vote" = 'for'), 0) AS votes_for,
         COALESCE(SUM(v."voting_power") FILTER (WHERE v."vote" = 'against'), 0) AS votes_against,
         COALESCE(SUM(v."voting_power") FILTER (WHERE v."vote" = 'abstain'), 0) AS votes_abstain,
         COALESCE(SUM(v."voting_power"), 0) AS total_voting_power,
         COUNT(v."id")::int AS unique_voters
    FROM "garden_proposal" p
    LEFT JOIN "garden_vote" v
           ON v."proposal_id" = p."id" AND v."deleted_at" IS NULL
   WHERE p."deleted_at" IS NULL
   GROUP BY p."id"`

/** The stored tally `p` disagrees with the recount `t` (all five columns are NOT NULL). */
const TALLY_DIFFERS = `(
       p."votes_for" <> t.votes_for
    OR p."votes_against" <> t.votes_against
    OR p."votes_abstain" <> t.votes_abstain
    OR p."total_voting_power" <> t.total_voting_power
    OR p."unique_voters" <> t.unique_voters)`

/** A bigNumber column's `raw_*` companion, written the way `castBallot` writes it. */
const raw = (col: string) =>
  `jsonb_build_object('value', trim_scale(t.${col})::text, ` +
  `'precision', COALESCE((p."raw_${col}"->>'precision')::int, 20))`

/**
 * Repairs the tallies of proposals still open for voting that the old votes
 * race left wrong (SD-86 (b)).
 *
 * `POST /store/proposals/:id/votes` used to write the tally as absolute
 * values computed from a proposal read at the start of the request, so
 * members voting at once overwrote each other's increments: every ballot was
 * written, but the tally counted fewer of them (Postgres: 4 members, tally 1).
 * `Migration20261115210000AddUniqueBallotIndex` recomputed only proposals
 * that also had a duplicate ballot; a proposal that only lost increments
 * kept its wrong tally, and the finalize job would decide it from that
 * (scratch Postgres 16: ballots 3.5 from 2 voters, tally 1 from 1 voter,
 * unchanged by that migration).
 *
 * 1. Every `active` proposal is locked, so a ballot being cast now cannot
 *    slip its increment between the recount and the write: a ballot that
 *    committed first is in the recount, and one still in flight adds its
 *    `col = col + ?` to the repaired value once this commits.
 * 2. Each `active` proposal whose stored tally differs from its live ballots
 *    gets the recount (numeric columns, their `raw_*` companions with the
 *    precision they already carry, `unique_voters`). The values it replaced
 *    are kept in `metadata.tally_before`, with `metadata.tally_recomputed_by`
 *    naming this migration. Status, result and quorum fields are not touched.
 * 3. A proposal that is not `active` (draft, submitted, passed, rejected,
 *    tie, expired, implemented, withdrawn, ...) is left as it is, even when
 *    its tally differs: a decided one's result was decided and acted on from
 *    the stored tally, and rewriting the tally under it would make the
 *    record disagree with the decision. Those are logged at warn, count and
 *    ids, for a person to rule on, each with its stored `unique_voters`, its
 *    live ballot count and the largest difference in the four sums:
 *    - `unique_voters` differing from the ballot count (below it, under the
 *      race): a ballot's increment was lost. The race wrote every column
 *      from one stale read, so a lost ballot always shows in the voter count;
 *    - voter count matching, sums differing only in far fractional digits:
 *      most likely float rounding, not a lost vote. Before `castBallot` the
 *      route added tallies in JS (`proposal.votes_for + voting_power`, last
 *      at `2eed5f0^`), and with non-dyadic garden `voting_weights` that
 *      leaves e.g. 0.8999999999999999 where the NUMERIC sum is 0.9.
 *    Active proposals with only that rounding are rewritten to the NUMERIC
 *    sum, which is what `castBallot`'s SQL increment writes.
 *
 * Proposals whose tally already matches are not written. A no-op on a table
 * where every tally matches.
 *
 * A finalize that read an active proposal's tally before this commits
 * decides on the old tally: its status UPDATE waits on the lock and lands
 * after. That proposal then has a status other than `active` and a repaired
 * tally that matches its ballots, so the warn above cannot list it; a status
 * other than `active` beside `metadata.tally_recomputed_by` finds it (the
 * operator query in docs/AUDIT_DEBT.md SD-86).
 */
export class Migration20261116090000RecomputeActiveProposalTallies extends Migration {
  override async up(): Promise<void> {
    await this.execute(
      `SELECT "id" FROM "garden_proposal"
        WHERE "status" = 'active' AND "deleted_at" IS NULL
        ORDER BY "id"
          FOR UPDATE`
    )

    const repaired = (await this.execute(`
      UPDATE "garden_proposal" AS p
         SET "votes_for" = t.votes_for,
             "raw_votes_for" = ${raw("votes_for")},
             "votes_against" = t.votes_against,
             "raw_votes_against" = ${raw("votes_against")},
             "votes_abstain" = t.votes_abstain,
             "raw_votes_abstain" = ${raw("votes_abstain")},
             "total_voting_power" = t.total_voting_power,
             "raw_total_voting_power" = ${raw("total_voting_power")},
             "unique_voters" = t.unique_voters,
             "metadata" = COALESCE(p."metadata", '{}'::jsonb) || jsonb_build_object(
               'tally_recomputed_by', '${MARKER}',
               'tally_before', jsonb_build_object(
                 'votes_for', p."votes_for",
                 'votes_against', p."votes_against",
                 'votes_abstain', p."votes_abstain",
                 'total_voting_power', p."total_voting_power",
                 'unique_voters', p."unique_voters"
               )
             ),
             "updated_at" = now()
        FROM (${LIVE_TALLY}) AS t
       WHERE p."id" = t."id"
         AND p."status" = 'active'
         AND p."deleted_at" IS NULL
         AND ${TALLY_DIFFERS}
   RETURNING p."id"`)) as Array<{ id: string }>

    const leftAsDecided = (await this.execute(`
      SELECT p."id", p."status",
             p."unique_voters" AS stored_voters,
             t.unique_voters AS live_ballots,
             GREATEST(abs(p."votes_for" - t.votes_for), abs(p."votes_against" - t.votes_against),
                      abs(p."votes_abstain" - t.votes_abstain),
                      abs(p."total_voting_power" - t.total_voting_power))::text AS max_sum_difference
        FROM "garden_proposal" p
        JOIN (${LIVE_TALLY}) AS t ON t."id" = p."id"
       WHERE p."status" <> 'active'
         AND ${TALLY_DIFFERS}
       ORDER BY p."id"`)) as Array<{
      id: string
      status: string
      stored_voters: number
      live_ballots: number
      max_sum_difference: string
    }>

    if (repaired.length) {
      log.info(`${MARKER}: recomputed the tally of ${repaired.length} active proposal(s) from their live ballots`, {
        proposal_ids: repaired.map((row) => row.id),
      })
    }
    if (leftAsDecided.length) {
      log.warn(
        `${MARKER}: ${leftAsDecided.length} proposal(s) not active have a tally that differs from ` +
          "their live ballots; left as they are, for review (see docs/AUDIT_DEBT.md SD-86). " +
          "unique_voters differing from the live ballot count means a ballot's increment was lost; a matching " +
          "count with sums differing only in far fractional digits is likely float rounding from " +
          "the old route, not a lost vote",
        {
          proposals: leftAsDecided.map(
            (row) =>
              `${row.id} (${row.status}; unique_voters ${row.stored_voters} of ${row.live_ballots} ` +
              `live ballots; largest sum difference ${row.max_sum_difference})`
          ),
        }
      )
    }
  }

  override async down(): Promise<void> {
    // Not undone: the tallies it replaced were wrong. Each repaired
    // proposal's previous values are in metadata.tally_before.
  }
}
