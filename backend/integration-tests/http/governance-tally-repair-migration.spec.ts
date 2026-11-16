import path from "path"
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { buildMigrationScript, ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { GOVERNANCE_MODULE } from "../../src/modules/governance"
import type { BallotChoice, GovernanceModuleService } from "../../src/modules/governance/service"

jest.setTimeout(180 * 1000)

const MIGRATION = "Migration20261116090000RecomputeActiveProposalTallies"

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
 * No HTTP: ballots and proposals are written through the module, so the
 * spec needs no accounts and stays clear of the account-creation limit.
 */
medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ getContainer }) => {
    const uid = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`

    it("recomputes active proposals' tallies from their live ballots, and leaves decided ones as they are", async () => {
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

      // A. Active, four voters; the race lost one member's increment (cus_d's
      // 2.5 "for"), and a ballot the index migration soft-deleted sits beside
      // the live ones and must not be counted.
      const lost = await proposal(`lost ${uid()}`)
      await cast(lost.id, "cus_a", "for", 1.5)
      await cast(lost.id, "cus_b", "against", 2)
      await cast(lost.id, "cus_c", "abstain", 1)
      await cast(lost.id, "cus_d", "for", 2.5)
      const asCast = await tally(lost.id)
      expect(
        [asCast.votes_for, asCast.votes_against, asCast.votes_abstain, asCast.total_voting_power].map(Number)
      ).toEqual([4, 2, 1, 7])
      expect(asCast.unique_voters).toBe(4)
      await governance.updateGardenProposals({
        id: lost.id,
        votes_for: 1.5,
        total_voting_power: 4.5,
        unique_voters: 3,
      })
      const removed = (await governance.createGardenVotes({
        proposal_id: lost.id,
        garden_id: gardenId,
        customer_id: "cus_e",
        membership_id: "mem_cus_e",
        vote: "for",
        voting_power: 10,
        power_basis: {},
        is_delegated: false,
        is_final: true,
        voted_at: new Date(),
        metadata: { soft_deleted_by: "Migration20261115210000AddUniqueBallotIndex" },
      })) as unknown as { id: string }
      await governance.softDeleteGardenVotes([removed.id])
      expect(await tally(lost.id)).toEqual(
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

      // C. Active, tally right: not written at all.
      const right = await proposal(`right ${uid()}`)
      await cast(right.id, "cus_a", "for", 2)
      await cast(right.id, "cus_b", "against", 1)
      const rightBefore = await wholeRow(right.id)

      // D. Active, a tally with no ballot behind it: recounted to zero.
      const empty = await proposal(`empty ${uid()}`)
      await governance.updateGardenProposals({ id: empty.id, votes_against: 3, total_voting_power: 3, unique_voters: 1 })

      // The harness already ran this migration at boot (on empty tables), by
      // the same script; un-record it so the script runs it again on this data.
      const recorded = await pg.raw(`SELECT name FROM mikro_orm_migrations WHERE name = ?`, [MIGRATION])
      expect(recorded.rows).toHaveLength(1)

      const runGovernanceMigrations = buildMigrationScript({
        moduleName: GOVERNANCE_MODULE,
        pathToMigrations: path.join(__dirname, "../../src/modules/governance/migrations"),
      })
      const clientUrl = container.resolve(ContainerRegistrationKeys.CONFIG_MODULE).projectConfig.databaseUrl
      const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
      const runAgain = async () => {
        await pg.raw(`DELETE FROM mikro_orm_migrations WHERE name = ?`, [MIGRATION])
        const ran = await runGovernanceMigrations({ options: { database: { clientUrl } }, logger })
        expect(ran.map((migration) => migration.name)).toEqual([MIGRATION])
      }

      // What the migration logs (the shared logger writes to the console).
      // Read before mockRestore, which clears the recorded calls.
      const warn = jest.spyOn(console, "warn")
      const info = jest.spyOn(console, "log")
      let warned: string
      let logged: string
      try {
        await runAgain()
      } finally {
        warned = warn.mock.calls.map((args) => args.join(" ")).join("\n")
        logged = info.mock.calls.map((args) => args.join(" ")).join("\n")
        warn.mockRestore()
        info.mockRestore()
      }

      // A is back to exactly what castBallot wrote: NUMERIC columns, raw_*
      // companions (value and precision), and the voter count.
      expect(await tally(lost.id)).toEqual(asCast)
      const repaired = await governance.retrieveGardenProposal(lost.id)
      expect([Number(repaired.votes_for), Number(repaired.total_voting_power), repaired.unique_voters]).toEqual([
        4, 7, 4,
      ])
      expect(await metadata(lost.id)).toEqual({
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

      // B and C are byte-for-byte what they were, updated_at included.
      expect(await wholeRow(decided.id)).toBe(decidedBefore)
      expect(await wholeRow(right.id)).toBe(rightBefore)

      // The decided proposal is reported for a person to rule on, and the
      // repaired ones are named.
      expect(warned).toContain(`${decided.id} (passed)`)
      expect(warned).not.toContain(right.id)
      expect(logged).toContain(lost.id)
      expect(logged).toContain(empty.id)
      expect(logged).not.toContain(right.id)

      // Once every active tally matches, a second run writes nothing.
      const repairedRow = await wholeRow(lost.id)
      await runAgain()
      expect(await wholeRow(lost.id)).toBe(repairedRow)
      expect(await wholeRow(decided.id)).toBe(decidedBefore)
    })
  },
})
