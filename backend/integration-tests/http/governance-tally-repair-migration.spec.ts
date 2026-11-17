import fs from "fs"
import path from "path"
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { buildMigrationScript, ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { GOVERNANCE_MODULE } from "../../src/modules/governance"
import {
  UNIQUE_BALLOT_INDEX,
  type BallotChoice,
  type GovernanceModuleService,
} from "../../src/modules/governance/service"

jest.setTimeout(180 * 1000)

const MIGRATION = "Migration20261116090000RecomputeActiveProposalTallies"
const INDEX_MIGRATION = "Migration20261115210000AddUniqueBallotIndex"

const MIGRATIONS_DIR = path.join(__dirname, "../../src/modules/governance/migrations")
const GOVERNANCE_MIGRATIONS = fs
  .readdirSync(MIGRATIONS_DIR)
  .filter((file) => /^Migration.*\.ts$/.test(file))
  .map((file) => file.replace(/\.ts$/, ""))
  .sort()

// The operator queries recorded in docs/AUDIT_DEBT.md with SD-86, run here
// character for character, so what the ledger tells an operator to run is
// what was tried on Postgres.

/** Check 1: proposals not active whose tally differs from their live ballots. */
const OPERATOR_CHECK_1 = `SELECT p.id, p.status, p.unique_voters, COALESCE(t.n, 0)::int AS live_ballots FROM garden_proposal p
           LEFT JOIN (SELECT proposal_id,
                             COALESCE(SUM(voting_power) FILTER (WHERE vote = 'for'), 0) AS f,
                             COALESCE(SUM(voting_power) FILTER (WHERE vote = 'against'), 0) AS a,
                             COALESCE(SUM(voting_power) FILTER (WHERE vote = 'abstain'), 0) AS b,
                             COALESCE(SUM(voting_power), 0) AS tot, COUNT(*) AS n
                        FROM garden_vote WHERE deleted_at IS NULL GROUP BY proposal_id) t ON t.proposal_id = p.id
          WHERE p.deleted_at IS NULL AND p.status <> 'active'
            AND (p.votes_for <> COALESCE(t.f, 0) OR p.votes_against <> COALESCE(t.a, 0)
                 OR p.votes_abstain <> COALESCE(t.b, 0) OR p.total_voting_power <> COALESCE(t.tot, 0)
                 OR p.unique_voters <> COALESCE(t.n, 0))
          ORDER BY p.id`

/** Check 2: proposals the repair recomputed that are no longer active. */
const OPERATOR_CHECK_2 = `SELECT id, status FROM garden_proposal
          WHERE metadata->>'tally_recomputed_by' = '${MIGRATION}' AND status <> 'active' ORDER BY id`

/**
 * Check 3: proposals not active whose tally the index migration rewrote,
 * found by the ballots it soft-deleted. Works whether or not the repair has
 * run.
 */
const OPERATOR_CHECK_3 = `SELECT p.id, p.status, p.approval_percentage, p.quorum_met, p.result_calculated_at, max(v.deleted_at) AS duplicates_removed_at, p.votes_for, p.votes_against, p.votes_abstain, p.total_voting_power, p.unique_voters FROM garden_proposal p JOIN garden_vote v ON v.proposal_id = p.id WHERE v.metadata->>'soft_deleted_by' = 'Migration20261115210000AddUniqueBallotIndex' AND p.status <> 'active' AND p.deleted_at IS NULL GROUP BY p.id ORDER BY p.id;`

/**
 * Check 3, by the mark the repair left: the set as it was when the repair
 * ran. The mark is on every listed proposal, decided before the rewrite or
 * after it, so the query returns `result_calculated_at` to tell them apart.
 */
const OPERATOR_CHECK_3_MARKED = `SELECT id, status, result_calculated_at, metadata->>'tally_rewritten_at' AS tally_rewritten_at FROM garden_proposal WHERE metadata->>'tally_rewritten_by' = 'Migration20261115210000AddUniqueBallotIndex' ORDER BY id;`

/**
 * Before the index migration runs: decided proposals that hold duplicate
 * live ballots, with the tally they were decided on. That migration rewrites
 * it and keeps no copy, so this output is the only one there will be.
 */
const PRE_DEPLOY_SNAPSHOT = `SELECT p.id, p.status, p.votes_for, p.votes_against, p.votes_abstain, p.total_voting_power, p.unique_voters, p.approval_percentage, p.quorum_met, p.result_calculated_at FROM garden_proposal p WHERE p.deleted_at IS NULL AND p.status <> 'active' AND EXISTS (SELECT 1 FROM garden_vote v WHERE v.proposal_id = p.id AND v.deleted_at IS NULL GROUP BY v.customer_id HAVING count(*) > 1) ORDER BY p.id;`

/**
 * `Migration20261116090000RecomputeActiveProposalTallies` on Postgres, run the
 * way the harness ran it at boot: the governance module's own migration
 * script (`buildMigrationScript`, the loader Medusa builds for every module),
 * through MikroORM's transactional runner.
 *
 * The old votes route wrote absolute tallies, so members voting at once
 * overwrote each other's increments. The ballot index migration recomputed
 * only proposals that also had a duplicate ballot. Here every ballot is cast
 * through `castBallot` first, so what it wrote is the reference; then the
 * tally is put back the way the race left it, written through the ORM as the
 * old route wrote it. The repair must restore exactly what `castBallot`
 * wrote, and leave alone what it should not touch.
 *
 * The second case is what the index migration itself did to decided
 * proposals: it recomputed every proposal that had a duplicate ballot,
 * whatever its status, and kept no copy of the tally. Both migrations are
 * run there, in order, on duplicates seeded with the index dropped.
 *
 * No HTTP: ballots and proposals are written through the module, so the
 * spec needs no accounts and stays clear of the account-creation limit.
 */
medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ getContainer }) => {
    const uid = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`

    /**
     * Seeding and read-back for one garden, through the module and the
     * connection the app booted with.
     */
    function fixtures() {
      const container = getContainer()
      const governance = container.resolve<GovernanceModuleService>(GOVERNANCE_MODULE)
      const pg = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
      const gardenId = `garden_${uid()}`

      const proposal = async (title: string) =>
        (await governance.createGardenProposals({
          garden_id: gardenId,
          title,
          description: "Tally repair",
          proposal_type: "policy",
          proposed_by_id: "cus_organizer",
          voting_start: new Date(Date.now() - 60_000),
          voting_end: new Date(Date.now() + 86_400_000),
          quorum_required: 50,
          approval_threshold: 50,
          status: "active",
        })) as unknown as { id: string }

      // Fractional and unequal weights: a recount by ballot count, or one that
      // loses NUMERIC scale, cannot match.
      const cast = async (proposalId: string, customer: string, vote: BallotChoice, power: number) => {
        const result = await governance.castBallot({
          proposal_id: proposalId,
          garden_id: gardenId,
          customer_id: customer,
          membership_id: `mem_${customer}`,
          vote,
          voting_power: power,
          power_basis: { base: 1 },
          comment: null,
          comment_visibility: "public",
          is_delegated: false,
          is_final: true,
          voted_at: new Date(),
        })
        expect(result.outcome).toBe("cast")
      }

      async function tally(proposalId: string) {
        const { rows } = await pg.raw(
          `SELECT votes_for::text AS votes_for, votes_against::text AS votes_against,
                  votes_abstain::text AS votes_abstain, total_voting_power::text AS total_voting_power,
                  unique_voters,
                  raw_votes_for AS raw_for, raw_votes_against AS raw_against,
                  raw_votes_abstain AS raw_abstain, raw_total_voting_power AS raw_total
             FROM garden_proposal WHERE id = ?`,
          [proposalId]
        )
        return rows[0] as Record<string, unknown>
      }
      async function wholeRow(proposalId: string) {
        const { rows } = await pg.raw(`SELECT row_to_json(p)::text AS row FROM garden_proposal p WHERE id = ?`, [
          proposalId,
        ])
        return rows[0].row as string
      }
      async function metadata(proposalId: string) {
        const { rows } = await pg.raw(`SELECT metadata FROM garden_proposal WHERE id = ?`, [proposalId])
        return rows[0].metadata as Record<string, unknown> | null
      }

      /**
       * A ballot written straight to the table, as the old route's insert
       * did: no tally increment, and nothing but the unique index to stop a
       * member's second one.
       */
      const ballot = async (
        proposalId: string,
        customer: string,
        vote: BallotChoice,
        power: number,
        ballotMetadata?: Record<string, unknown>
      ) =>
        (await governance.createGardenVotes({
          proposal_id: proposalId,
          garden_id: gardenId,
          customer_id: customer,
          membership_id: `mem_${customer}`,
          vote,
          voting_power: power,
          power_basis: {},
          is_delegated: false,
          is_final: true,
          voted_at: new Date(),
          ...(ballotMetadata ? { metadata: ballotMetadata } : {}),
        })) as unknown as { id: string }

      /**
       * Runs exactly `names` again, in order, through the governance
       * module's own migration script, and returns what they logged (the
       * shared logger writes to the console). The harness ran every
       * migration at boot on empty tables; un-recording one makes the script
       * run it on this data. The runner truncates every table between tests,
       * `mikro_orm_migrations` included, so the module's other migrations
       * are recorded as run first.
       */
      const runGovernanceMigrations = buildMigrationScript({
        moduleName: GOVERNANCE_MODULE,
        pathToMigrations: MIGRATIONS_DIR,
      })
      const clientUrl = container.resolve(ContainerRegistrationKeys.CONFIG_MODULE).projectConfig.databaseUrl
      const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
      async function rerun(names: string[]) {
        for (const name of names) expect(GOVERNANCE_MIGRATIONS).toContain(name)
        for (const name of GOVERNANCE_MIGRATIONS) {
          await pg.raw(`DELETE FROM mikro_orm_migrations WHERE name = ?`, [name])
          if (!names.includes(name)) {
            await pg.raw(`INSERT INTO mikro_orm_migrations (name) VALUES (?)`, [name])
          }
        }
        // Read before mockRestore, which clears the recorded calls.
        const warn = jest.spyOn(console, "warn")
        const info = jest.spyOn(console, "log")
        try {
          const ran = await runGovernanceMigrations({ options: { database: { clientUrl } }, logger })
          expect(ran.map((migration) => migration.name)).toEqual(names)
          return {
            warned: warn.mock.calls.map((args) => args.join(" ")).join("\n"),
            logged: info.mock.calls.map((args) => args.join(" ")).join("\n"),
          }
        } finally {
          warn.mockRestore()
          info.mockRestore()
        }
      }

      return { governance, pg, gardenId, proposal, cast, tally, wholeRow, metadata, ballot, rerun }
    }

    it("recomputes active proposals' tallies from their live ballots, and leaves decided ones as they are", async () => {
      const { governance, pg, proposal, cast, tally, wholeRow, metadata, ballot, rerun } = fixtures()

      // A. The third review's case on its own: active, ballots 3.5 from two
      // voters, the tally 1 from one voter (the race lost cus_b's increment),
      // no duplicate and no soft-deleted ballot. The index migration never
      // looked at it; a repair that keyed on its duplicate marker would not
      // either.
      const lost = await proposal(`lost ${uid()}`)
      await cast(lost.id, "cus_a", "for", 1)
      await cast(lost.id, "cus_b", "for", 2.5)
      const asCast = await tally(lost.id)
      expect(
        [asCast.votes_for, asCast.votes_against, asCast.votes_abstain, asCast.total_voting_power].map(Number)
      ).toEqual([3.5, 0, 0, 3.5])
      expect(asCast.unique_voters).toBe(2)
      await governance.updateGardenProposals({ id: lost.id, votes_for: 1, total_voting_power: 1, unique_voters: 1 })
      expect(await tally(lost.id)).toEqual(
        expect.objectContaining({ votes_for: "1", total_voting_power: "1", unique_voters: 1 })
      )
      const { rows: lostBallots } = await pg.raw(
        `SELECT count(*)::int AS live, count(*) FILTER (WHERE deleted_at IS NOT NULL)::int AS removed
           FROM garden_vote WHERE proposal_id = ?`,
        [lost.id]
      )
      expect(lostBallots[0]).toEqual({ live: 2, removed: 0 })

      // E. Active, four voters, one increment lost (cus_d's 2.5 "for"), and a
      // ballot the index migration soft-deleted beside the live ones, which
      // must not be counted.
      const withRemoved = await proposal(`removed ${uid()}`)
      await cast(withRemoved.id, "cus_a", "for", 1.5)
      await cast(withRemoved.id, "cus_b", "against", 2)
      await cast(withRemoved.id, "cus_c", "abstain", 1)
      await cast(withRemoved.id, "cus_d", "for", 2.5)
      const withRemovedAsCast = await tally(withRemoved.id)
      expect(
        [
          withRemovedAsCast.votes_for,
          withRemovedAsCast.votes_against,
          withRemovedAsCast.votes_abstain,
          withRemovedAsCast.total_voting_power,
        ].map(Number)
      ).toEqual([4, 2, 1, 7])
      expect(withRemovedAsCast.unique_voters).toBe(4)
      await governance.updateGardenProposals({
        id: withRemoved.id,
        votes_for: 1.5,
        total_voting_power: 4.5,
        unique_voters: 3,
      })
      const removed = await ballot(withRemoved.id, "cus_e", "for", 10, { soft_deleted_by: INDEX_MIGRATION })
      await governance.softDeleteGardenVotes([removed.id])
      expect(await tally(withRemoved.id)).toEqual(
        expect.objectContaining({ votes_for: "1.5", total_voting_power: "4.5", unique_voters: 3 })
      )

      // B. Decided on a tally the race had cut short: left as it is, logged.
      const decided = await proposal(`decided ${uid()}`)
      await cast(decided.id, "cus_a", "for", 1.5)
      await cast(decided.id, "cus_b", "for", 2.5)
      await governance.updateGardenProposals({ id: decided.id, votes_for: 1.5, total_voting_power: 1.5, unique_voters: 1 })
      await pg.raw(
        `UPDATE garden_proposal
            SET status = 'passed', result_calculated_at = now(), quorum_met = true, approval_percentage = 100
          WHERE id = ?`,
        [decided.id]
      )
      const decidedBefore = await wholeRow(decided.id)

      // F. Decided, no ballot lost, the tally off only in float rounding: the
      // old route added in JS, so 0.1 + 0.2 was written as
      // 0.30000000000000004 where the NUMERIC sum is 0.3. Left as it is and
      // reported with a matching voter count, so it can be told from B.
      const rounded = await proposal(`rounded ${uid()}`)
      await cast(rounded.id, "cus_a", "for", 0.1)
      await cast(rounded.id, "cus_b", "for", 0.2)
      await governance.updateGardenProposals({
        id: rounded.id,
        votes_for: 0.1 + 0.2,
        total_voting_power: 0.1 + 0.2,
      })
      await pg.raw(`UPDATE garden_proposal SET status = 'passed', result_calculated_at = now() WHERE id = ?`, [
        rounded.id,
      ])
      expect(await tally(rounded.id)).toEqual(
        expect.objectContaining({ votes_for: "0.30000000000000004", unique_voters: 2 })
      )
      const roundedBefore = await wholeRow(rounded.id)

      // C. Active, tally right: not written at all.
      const right = await proposal(`right ${uid()}`)
      await cast(right.id, "cus_a", "for", 2)
      await cast(right.id, "cus_b", "against", 1)
      const rightBefore = await wholeRow(right.id)

      // D. Active, a tally with no ballot behind it: recounted to zero.
      const empty = await proposal(`empty ${uid()}`)
      await governance.updateGardenProposals({ id: empty.id, votes_against: 3, total_voting_power: 3, unique_voters: 1 })

      // The harness already ran this migration at boot (on empty tables), by
      // the same script; `rerun` un-records it so the script runs it again
      // on this data.
      const recorded = await pg.raw(`SELECT name FROM mikro_orm_migrations WHERE name = ?`, [MIGRATION])
      expect(recorded.rows).toHaveLength(1)

      const { warned, logged } = await rerun([MIGRATION])

      // A, the lost increment with no duplicate behind it, is back to exactly
      // what castBallot wrote: NUMERIC columns, raw_* companions (value and
      // precision), and the voter count.
      expect(await tally(lost.id)).toEqual(asCast)
      const repaired = await governance.retrieveGardenProposal(lost.id)
      expect([Number(repaired.votes_for), Number(repaired.total_voting_power), repaired.unique_voters]).toEqual([
        3.5, 3.5, 2,
      ])
      expect(await metadata(lost.id)).toEqual({
        tally_recomputed_by: MIGRATION,
        tally_before: { votes_for: 1, votes_against: 0, votes_abstain: 0, total_voting_power: 1, unique_voters: 1 },
      })

      // E likewise, with its soft-deleted ballot left out of the count.
      expect(await tally(withRemoved.id)).toEqual(withRemovedAsCast)
      expect(await metadata(withRemoved.id)).toEqual({
        tally_recomputed_by: MIGRATION,
        tally_before: { votes_for: 1.5, votes_against: 2, votes_abstain: 1, total_voting_power: 4.5, unique_voters: 3 },
      })

      // D is recounted to zero.
      expect(await tally(empty.id)).toEqual(
        expect.objectContaining({
          votes_for: "0",
          votes_against: "0",
          votes_abstain: "0",
          total_voting_power: "0",
          unique_voters: 0,
          raw_against: { value: "0", precision: 20 },
          raw_total: { value: "0", precision: 20 },
        })
      )

      // B, F and C are byte-for-byte what they were, updated_at included.
      expect(await wholeRow(decided.id)).toBe(decidedBefore)
      expect(await wholeRow(rounded.id)).toBe(roundedBefore)
      expect(await wholeRow(right.id)).toBe(rightBefore)

      // The proposals left as they are are reported for a person to rule on,
      // each with what tells a lost ballot (B: 1 of 2 voters counted) from
      // float rounding (F: every voter counted, a difference far down the
      // fraction); the repaired ones are named.
      expect(warned).toContain("not active")
      expect(warned).not.toContain("no longer active")
      expect(warned).toContain(`${decided.id} (passed; unique_voters 1 of 2 live ballots; largest sum difference 2.5)`)
      expect(warned).toContain(
        `${rounded.id} (passed; unique_voters 2 of 2 live ballots; largest sum difference 0.00000000000000004)`
      )
      expect(warned).not.toContain(right.id)
      expect(logged).toContain(lost.id)
      expect(logged).toContain(withRemoved.id)
      expect(logged).toContain(empty.id)
      expect(logged).not.toContain(right.id)
      // No decided proposal here had a duplicate ballot removed by the index
      // migration (E, which carries one, is active), so the report of
      // rewritten tallies is not raised and nothing is marked.
      expect(warned).not.toContain("had their tally rewritten")
      expect((await pg.raw(OPERATOR_CHECK_3_MARKED)).rows).toEqual([])

      // The operator check recorded with SD-86 lists what the migration left
      // for review, and only that, with the voter counts that tell the two
      // kinds apart.
      const { rows: forReview } = await pg.raw(OPERATOR_CHECK_1)
      expect(forReview).toEqual(
        [
          { id: decided.id, status: "passed", unique_voters: 1, live_ballots: 2 },
          { id: rounded.id, status: "passed", unique_voters: 2, live_ballots: 2 },
        ].sort((x, y) => (x.id < y.id ? -1 : 1))
      )

      // Once every active tally matches, a second run writes nothing.
      const repairedRow = await wholeRow(lost.id)
      await rerun([MIGRATION])
      expect(await wholeRow(lost.id)).toBe(repairedRow)
      expect(await wholeRow(decided.id)).toBe(decidedBefore)
      expect(await wholeRow(rounded.id)).toBe(roundedBefore)

      // A finalize that read A's tally before the repair committed lands its
      // status after it. A then matches its ballots, so the check above
      // cannot list it; the second operator check does, for its outcome to
      // be re-checked against the repaired tally.
      expect((await pg.raw(OPERATOR_CHECK_2)).rows).toEqual([])
      await pg.raw(`UPDATE garden_proposal SET status = 'passed', result_calculated_at = now() WHERE id = ?`, [lost.id])
      expect((await pg.raw(OPERATOR_CHECK_2)).rows).toEqual([{ id: lost.id, status: "passed" }])
    })

    it("reports and marks decided proposals whose tally the index migration rewrote, which no other check lists", async () => {
      const { governance, pg, proposal, cast, tally, wholeRow, metadata, ballot, rerun } = fixtures()
      const byId = <T extends { id: string }>(rows: T[]) => [...rows].sort((x, y) => (x.id < y.id ? -1 : 1))
      const decide = (proposalId: string, status: string, approval: number, at = "now()") =>
        pg.raw(
          `UPDATE garden_proposal
              SET status = ?, result_calculated_at = ${at}, quorum_met = true, approval_percentage = ?
            WHERE id = ?`,
          [status, approval, proposalId]
        )

      // G. The review's case. Two members vote; the second one's request is
      // then repeated (the duplicate the old route let through), and the
      // tally is what that route left: both of cus_b's ballots counted.
      const rewritten = await proposal(`rewritten ${uid()}`)
      await cast(rewritten.id, "cus_a", "for", 1)
      await cast(rewritten.id, "cus_b", "against", 2)
      // H. The same on a proposal still open: the index migration's recount
      // is the repair there, and nothing is left to report.
      const open = await proposal(`open ${uid()}`)
      await cast(open.id, "cus_a", "for", 1.5)
      // I. Decided, never had a duplicate.
      const untouched = await proposal(`untouched ${uid()}`)
      await cast(untouched.id, "cus_a", "for", 2)
      // J. Had its duplicate removed while it was open, and was decided
      // afterwards, on the recomputed tally. A third member abstains: the
      // approval the report works out from the tally must leave abstentions
      // out, as finalize does (`decideProposalOutcome`: for / (for +
      // against)). 1 for and 3 against is 25 with or without the 1.5
      // abstaining; over the total voting power it would be 18.18.
      const decidedAfter = await proposal(`decided after ${uid()}`)
      await cast(decidedAfter.id, "cus_a", "for", 1)
      await cast(decidedAfter.id, "cus_b", "against", 3)
      await cast(decidedAfter.id, "cus_c", "abstain", 1.5)
      // K. Decided on a tally that counted a duplicate, then deleted.
      const deleted = await proposal(`deleted ${uid()}`)
      await cast(deleted.id, "cus_a", "for", 1)
      // L. Withdrawn with a duplicate on it: no result was ever calculated.
      const withdrawn = await proposal(`withdrawn ${uid()}`)
      await cast(withdrawn.id, "cus_a", "for", 1)

      // A member's second live ballot can only be written without the index.
      await pg.raw(`DROP INDEX "${UNIQUE_BALLOT_INDEX}"`)

      await ballot(rewritten.id, "cus_b", "against", 2)
      await governance.updateGardenProposals({ id: rewritten.id, votes_against: 4, total_voting_power: 5, unique_voters: 3 })
      await decide(rewritten.id, "rejected", 20)

      await ballot(open.id, "cus_a", "for", 1.5)
      await governance.updateGardenProposals({ id: open.id, votes_for: 3, total_voting_power: 3, unique_voters: 2 })

      await decide(untouched.id, "passed", 100)
      const untouchedBefore = await wholeRow(untouched.id)

      const removedEarlier = await ballot(decidedAfter.id, "cus_b", "against", 3, { soft_deleted_by: INDEX_MIGRATION })
      await governance.softDeleteGardenVotes([removedEarlier.id])
      await pg.raw(`UPDATE garden_vote SET deleted_at = '2026-11-10T08:00:00Z' WHERE id = ?`, [removedEarlier.id])
      await decide(decidedAfter.id, "rejected", 25, "'2026-11-12T09:30:00Z'")

      await ballot(deleted.id, "cus_a", "for", 1)
      await governance.updateGardenProposals({ id: deleted.id, votes_for: 2, total_voting_power: 2, unique_voters: 2 })
      await decide(deleted.id, "passed", 100)
      await governance.softDeleteGardenProposals([deleted.id])

      await ballot(withdrawn.id, "cus_a", "for", 1)
      await governance.updateGardenProposals({ id: withdrawn.id, votes_for: 2, total_voting_power: 2, unique_voters: 2 })
      await pg.raw(`UPDATE garden_proposal SET status = 'withdrawn' WHERE id = ?`, [withdrawn.id])

      // Before the index migration runs, the pre-deploy snapshot recorded
      // with SD-86 gives the tally each decided proposal with a duplicate
      // was decided on. It is the last moment that tally can be read.
      const { rows: snapshot } = await pg.raw(PRE_DEPLOY_SNAPSHOT)
      expect(
        snapshot.map((row: Record<string, unknown>) => ({
          id: row.id,
          status: row.status,
          tally: [row.votes_for, row.votes_against, row.votes_abstain, row.total_voting_power].map(Number),
          unique_voters: row.unique_voters,
          approval_percentage: row.approval_percentage === null ? null : Number(row.approval_percentage),
          quorum_met: row.quorum_met,
          decided: row.result_calculated_at !== null,
        }))
      ).toEqual(
        byId([
          {
            id: rewritten.id,
            status: "rejected",
            tally: [1, 4, 0, 5],
            unique_voters: 3,
            approval_percentage: 20,
            quorum_met: true,
            decided: true,
          },
          {
            id: withdrawn.id,
            status: "withdrawn",
            tally: [2, 0, 0, 2],
            unique_voters: 2,
            approval_percentage: null,
            quorum_met: null,
            decided: false,
          },
        ])
      )
      const decidedOn = await wholeRow(rewritten.id)

      // Both migrations, in the order every deploy runs them.
      const { warned, logged } = await rerun([INDEX_MIGRATION, MIGRATION])

      // What the index migration did to G: the duplicate is soft-deleted and
      // the tally is its live ballots, under a decision made on another one.
      // Rejected at approval 20 (1 for, 4 against), it now reads 1 for and 2
      // against, which is 33.33, and nothing on the row but the result
      // fields says it was ever otherwise.
      const after = JSON.parse(await wholeRow(rewritten.id)) as Record<string, unknown>
      const before = JSON.parse(decidedOn) as Record<string, unknown>
      expect([after.votes_for, after.votes_against, after.votes_abstain, after.total_voting_power].map(Number)).toEqual([
        1, 2, 0, 3,
      ])
      expect(after.unique_voters).toBe(2)
      expect([after.status, Number(after.approval_percentage), after.quorum_met, after.result_calculated_at]).toEqual([
        "rejected",
        20,
        true,
        before.result_calculated_at,
      ])
      const { rows: removedBallots } = await pg.raw(
        `SELECT deleted_at FROM garden_vote WHERE proposal_id = ? AND metadata->>'soft_deleted_by' = ?`,
        [rewritten.id, INDEX_MIGRATION]
      )
      expect(removedBallots).toHaveLength(1)

      // Neither check the ledger had can list it: its tally now matches its
      // ballots (check 1, and the repair's own warn about differing
      // tallies), and the repair did not recompute it (check 2).
      expect((await pg.raw(OPERATOR_CHECK_1)).rows).toEqual([])
      expect((await pg.raw(OPERATOR_CHECK_2)).rows).toEqual([])
      expect(warned).not.toContain("have a tally that differs")

      // The repair reports it, with what is left to rule on: the decision
      // as recorded, when it was made against when the ballots were removed,
      // and the tally as it stands with the approval that gives.
      expect(warned).toContain(`3 proposal(s) not active had their tally rewritten by ${INDEX_MIGRATION}`)
      expect(warned).toContain("approval_percentage and quorum_met are the only trace of it")
      const stamp = "\\d{4}-\\d\\d-\\d\\dT\\d\\d:\\d\\d:\\d\\d\\.\\d{3}Z"
      expect(warned).toMatch(
        new RegExp(
          `${rewritten.id} \\(rejected; approval_percentage 20, quorum_met true, result calculated ${stamp}, ` +
            `before the rewrite; 1 duplicate ballot\\(s\\) removed ${stamp}; tally now for 1, against 2, ` +
            `abstain 0, total 3, unique_voters 2, which gives approval 33\\.33\\)`
        )
      )
      // J was decided after its duplicate went, so on the tally it has: the
      // approval worked out from that tally is the one it was decided at,
      // the abstention counted in the total and in the voters and left out
      // of the approval.
      expect(warned).toContain(
        `${decidedAfter.id} (rejected; approval_percentage 25, quorum_met true, result calculated ` +
          `2026-11-12T09:30:00.000Z, after the rewrite; 1 duplicate ballot(s) removed 2026-11-10T08:00:00.000Z; ` +
          `tally now for 1, against 3, abstain 1.5, total 5.5, unique_voters 3, which gives approval 25)`
      )
      expect(warned).toMatch(
        new RegExp(
          `${withdrawn.id} \\(withdrawn; approval_percentage none, quorum_met none, no result calculated; ` +
            `1 duplicate ballot\\(s\\) removed ${stamp}; tally now for 1, against 0, abstain 0, total 1, ` +
            `unique_voters 1, which gives approval 100\\)`
        )
      )
      // Not the open one, the one that never had a duplicate, or the deleted one.
      for (const other of [open.id, untouched.id, deleted.id]) {
        expect(warned).not.toContain(other)
        expect(logged).not.toContain(other)
      }

      // Each reported proposal is marked, and only in metadata: G is
      // otherwise the row the index migration left.
      const mark = await metadata(rewritten.id)
      expect(mark).toEqual({
        tally_rewritten_by: INDEX_MIGRATION,
        tally_rewritten_at: expect.any(String),
        tally_rewrite_recorded_by: MIGRATION,
      })
      expect(new Date(String(mark?.tally_rewritten_at)).getTime()).toBe(new Date(removedBallots[0].deleted_at).getTime())
      expect(await metadata(decidedAfter.id)).toEqual({
        tally_rewritten_by: INDEX_MIGRATION,
        tally_rewritten_at: expect.any(String),
        tally_rewrite_recorded_by: MIGRATION,
      })
      expect(new Date(String((await metadata(decidedAfter.id))?.tally_rewritten_at)).toISOString()).toBe(
        "2026-11-10T08:00:00.000Z"
      )
      expect(await metadata(withdrawn.id)).toEqual(expect.objectContaining({ tally_rewritten_by: INDEX_MIGRATION }))

      // H was open: recounted by the index migration, which is the repair,
      // and neither reported nor marked. I is byte for byte what it was. K,
      // deleted, is not marked.
      expect(await tally(open.id)).toEqual(expect.objectContaining({ votes_for: "1.5", total_voting_power: "1.5", unique_voters: 1 }))
      expect(await metadata(open.id)).toBeNull()
      expect(await wholeRow(untouched.id)).toBe(untouchedBefore)
      expect(await metadata(deleted.id)).toBeNull()

      // Operator check 3 recorded with SD-86, by the removed ballots and by
      // the mark: the same three, with the decision and the tally as it is.
      const { rows: check3 } = await pg.raw(OPERATOR_CHECK_3)
      expect(
        check3.map((row: Record<string, unknown>) => ({
          id: row.id,
          status: row.status,
          approval_percentage: row.approval_percentage === null ? null : Number(row.approval_percentage),
          tally: [row.votes_for, row.votes_against, row.votes_abstain, row.total_voting_power].map(Number),
          unique_voters: row.unique_voters,
          decided_before_removal:
            row.result_calculated_at === null
              ? null
              : new Date(row.result_calculated_at as string) < new Date(row.duplicates_removed_at as string),
        }))
      ).toEqual(
        byId([
          {
            id: rewritten.id,
            status: "rejected",
            approval_percentage: 20,
            tally: [1, 2, 0, 3],
            unique_voters: 2,
            decided_before_removal: true,
          },
          {
            id: decidedAfter.id,
            status: "rejected",
            approval_percentage: 25,
            tally: [1, 3, 1.5, 5.5],
            unique_voters: 3,
            decided_before_removal: false,
          },
          {
            id: withdrawn.id,
            status: "withdrawn",
            approval_percentage: null,
            tally: [1, 0, 0, 1],
            unique_voters: 1,
            decided_before_removal: null,
          },
        ])
      )
      // By the mark alone the two kinds can still be told apart: the mark
      // is on J as well, which was decided on the tally it has.
      const { rows: marked } = await pg.raw(OPERATOR_CHECK_3_MARKED)
      expect(
        marked.map((row: Record<string, unknown>) => ({
          id: row.id,
          status: row.status,
          decided_before_rewrite:
            row.result_calculated_at === null
              ? null
              : new Date(row.result_calculated_at as string) < new Date(row.tally_rewritten_at as string),
        }))
      ).toEqual(
        byId([
          { id: rewritten.id, status: "rejected", decided_before_rewrite: true },
          { id: decidedAfter.id, status: "rejected", decided_before_rewrite: false },
          { id: withdrawn.id, status: "withdrawn", decided_before_rewrite: null },
        ])
      )
      expect(marked.map((row: { id: string }) => row.id)).toEqual(check3.map((row: { id: string }) => row.id))
      // Nothing is left for the snapshot to read: it has to be taken first.
      expect((await pg.raw(PRE_DEPLOY_SNAPSHOT)).rows).toEqual([])

      // The index is back, so no further duplicate can be written.
      const { rows: index } = await pg.raw(`SELECT indexname FROM pg_indexes WHERE indexname = ?`, [UNIQUE_BALLOT_INDEX])
      expect(index).toHaveLength(1)

      // The mark is all the repair writes on a decided proposal. With G's
      // mark taken off and the repair run alone, the row comes back exactly
      // as it was, updated_at included; and a run over marked rows writes
      // nothing, while still reporting them.
      const markedRow = await wholeRow(rewritten.id)
      await pg.raw(`UPDATE garden_proposal SET metadata = NULL WHERE id = ?`, [rewritten.id])
      expect(await wholeRow(rewritten.id)).not.toBe(markedRow)
      await rerun([MIGRATION])
      expect(await wholeRow(rewritten.id)).toBe(markedRow)
      const again = await rerun([MIGRATION])
      expect(await wholeRow(rewritten.id)).toBe(markedRow)
      expect(await wholeRow(untouched.id)).toBe(untouchedBefore)
      expect(again.warned).toContain(`3 proposal(s) not active had their tally rewritten by ${INDEX_MIGRATION}`)
    })
  },
})
