import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createPublishableKeyToken } from "./_publishable-key"
import { safe } from "./helpers/seller-auth"
import { GARDEN_MODULE } from "../../src/modules/garden"
import { GOVERNANCE_MODULE } from "../../src/modules/governance"

jest.setTimeout(180 * 1000)

/**
 * `POST /store/proposals/:id/votes` under concurrency, on Postgres with the
 * real middleware stack.
 *
 * The route read "has this customer voted?", inserted the ballot, then wrote
 * the tally as absolute values computed from the proposal it read at the
 * start. A probe on this stack found both halves of the race: six concurrent
 * votes from one member wrote 4 to 6 ballots, and four members voting at once
 * left the tally at 1. The fix is a partial unique index on
 * garden_vote(proposal_id, customer_id) and a tally of `col = col + ?` in the
 * ballot's own transaction (`GovernanceModuleService.castBallot`), which
 * also re-checks that the proposal is still open, so a ballot cannot land
 * after the proposal was finalized. None of it can be shown with a fake
 * Query, so this runs against the migrated schema.
 *
 * Its own file because each spec boots its own app, and the four customers
 * here would push store-community-write-authz.spec.ts past the
 * 20-a-minute limit account creation shares.
 */
medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    const uid = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`

    async function signedInCustomer(pak: string) {
      const email = `votes-${uid()}@example.com`
      const password = `${uid()}-pw`
      const registered = await api.post("/auth/customer/emailpass/register", { email, password })
      const created = await api.post(
        "/store/customers",
        { email },
        { headers: { authorization: `Bearer ${registered.data.token}`, "x-publishable-api-key": pak } }
      )
      const login = await api.post("/auth/customer/emailpass", { email, password })
      return {
        id: created.data.customer.id as string,
        headers: { headers: { authorization: `Bearer ${login.data.token}`, "x-publishable-api-key": pak } },
      }
    }

    it("one ballot per member, and every ballot in the tally, when votes arrive at once", async () => {
      const pak = await createPublishableKeyToken(getContainer)
      const organizer = await signedInCustomer(pak)
      const members = [await signedInCustomer(pak), await signedInCustomer(pak), await signedInCustomer(pak)]
      const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const governance = getContainer().resolve(GOVERNANCE_MODULE)
      const pg = getContainer().resolve(ContainerRegistrationKeys.PG_CONNECTION)

      const garden = await safe(
        api.post(
          "/store/gardens",
          { name: `Votes ${uid()}`, address: "1 Main St", city: "Oakland", state: "CA", zip: "94607" },
          organizer.headers
        )
      )
      expect(garden.status).toBe(201)
      const gardenId = garden.data.garden.id as string
      const { data: [organizerMembership] } = await query.graph({
        entity: "garden_membership",
        fields: ["id"],
        filters: { garden_id: gardenId, customer_id: organizer.id },
      })

      // Different hours give different weights, so a lost increment cannot
      // hide behind equal ballots, and fractional weights exercise the
      // NUMERIC arithmetic and its raw_* companions.
      const memberships = await Promise.all(
        members.map((m, i) =>
          getContainer()
            .resolve(GARDEN_MODULE)
            .createGardenMemberships({
              garden_id: gardenId,
              customer_id: m.id,
              membership_type: "volunteer",
              status: "active",
              volunteer_hours_balance: [20, 30, 0][i],
              joined_at: new Date(),
            })
        )
      )

      const proposal = (title: string) =>
        governance.createGardenProposals({
          garden_id: gardenId,
          title,
          description: "Concurrency",
          proposal_type: "policy",
          proposed_by_id: organizer.id,
          voting_start: new Date(Date.now() - 60_000),
          voting_end: new Date(Date.now() + 86_400_000),
          quorum_required: 50,
          approval_threshold: 50,
          status: "active",
        })

      async function tally(proposalId: string) {
        const { rows } = await pg.raw(
          `SELECT votes_for::text AS votes_for, votes_against::text AS votes_against,
                  votes_abstain::text AS votes_abstain, total_voting_power::text AS total_voting_power,
                  unique_voters,
                  raw_votes_for->>'value' AS raw_for, raw_votes_against->>'value' AS raw_against,
                  raw_votes_abstain->>'value' AS raw_abstain, raw_total_voting_power->>'value' AS raw_total
             FROM garden_proposal WHERE id = ?`,
          [proposalId]
        )
        return rows[0] as Record<string, string | number>
      }

      // 1. One member, six simultaneous ballots: exactly one is written.
      const solo = await proposal(`solo ${uid()}`)
      const soloResults = await Promise.all(
        Array.from({ length: 6 }, () =>
          safe(
            api.post(
              `/store/proposals/${solo.id}/votes`,
              { membership_id: organizerMembership.id, vote: "for" },
              organizer.headers
            )
          )
        )
      )
      expect(soloResults.map((r) => r.status).sort()).toEqual([201, 400, 400, 400, 400, 400])
      for (const refused of soloResults.filter((r) => r.status === 400)) {
        expect(refused.data.message).toBe("You have already voted on this proposal")
      }
      const soloBallots: Array<Record<string, unknown>> = await governance.listGardenVotes({ proposal_id: solo.id })
      expect(soloBallots).toHaveLength(1)
      const soloPower = Number(soloBallots[0].voting_power)
      expect(await tally(solo.id)).toEqual(
        expect.objectContaining({
          votes_for: String(soloPower),
          raw_for: String(soloPower),
          total_voting_power: String(soloPower),
          raw_total: String(soloPower),
          unique_voters: 1,
        })
      )
      const listed = await safe(
        api.get(`/store/proposals/${solo.id}/votes`, { headers: { "x-publishable-api-key": pak } })
      )
      expect(listed.status).toBe(200)
      expect(listed.data.votes).toHaveLength(1)

      // 2. Four members at once, mixed choices: every ballot is counted once.
      const mixed = await proposal(`mixed ${uid()}`)
      const voters: Array<[{ headers: unknown }, string, string]> = [
        [organizer, organizerMembership.id as string, "for"],
        [members[0], memberships[0].id, "for"],
        [members[1], memberships[1].id, "against"],
        [members[2], memberships[2].id, "abstain"],
      ]
      const mixedResults = await Promise.all(
        voters.map(([who, membershipId, choice]) =>
          safe(
            api.post(
              `/store/proposals/${mixed.id}/votes`,
              { membership_id: membershipId, vote: choice },
              who.headers as Record<string, unknown>
            )
          )
        )
      )
      expect(mixedResults.map((r) => r.status)).toEqual([201, 201, 201, 201])

      const ballots: Array<Record<string, unknown>> = await governance.listGardenVotes({ proposal_id: mixed.id })
      expect(ballots).toHaveLength(4)
      const sum = (choice?: string) =>
        ballots
          .filter((b) => !choice || b.vote === choice)
          .reduce((total, b) => total + Number(b.voting_power), 0)
      // The weights really differ (1, 2, 2.5 and 1 under the route's formula).
      expect(new Set(ballots.map((b) => Number(b.voting_power))).size).toBeGreaterThan(1)

      const after = await tally(mixed.id)
      expect({
        for: Number(after.votes_for),
        against: Number(after.votes_against),
        abstain: Number(after.votes_abstain),
        total: Number(after.total_voting_power),
        voters: after.unique_voters,
      }).toEqual({ for: sum("for"), against: sum("against"), abstain: sum("abstain"), total: sum(), voters: 4 })
      // The JSONB companions the ORM can read carry the same numbers.
      expect([after.raw_for, after.raw_against, after.raw_abstain, after.raw_total].map(Number)).toEqual([
        sum("for"),
        sum("against"),
        sum("abstain"),
        sum(),
      ])
      const viaModule = await governance.retrieveGardenProposal(mixed.id)
      expect(Number(viaModule.votes_for)).toBe(sum("for"))
      expect(Number(viaModule.total_voting_power)).toBe(sum())
      expect(viaModule.unique_voters).toBe(4)

      // A member who voted cannot vote again, sequentially either.
      const again = await safe(
        api.post(
          `/store/proposals/${mixed.id}/votes`,
          { membership_id: memberships[1].id, vote: "for" },
          members[1].headers
        )
      )
      expect(again.status).toBe(400)
      expect(Number((await tally(mixed.id)).total_voting_power)).toBe(sum())

      // 3. A ballot whose request read an open proposal, but whose tally
      // write lands after the proposal was finalized, is refused and rolled
      // back. The finalize is played by a transaction that holds the
      // proposal row, waits until the ballot's tally UPDATE is queued behind
      // it, then sets the result and commits, as finalizeProposalWorkflow's
      // update would. The UPDATE re-reads the committed row, finds it no
      // longer active, and the ballot goes with it.
      const closing = await proposal(`closing ${uid()}`)
      const finalize = await pg.transaction()
      let late: { status: number; data: { message?: string } }
      try {
        await finalize.raw(`SELECT id FROM garden_proposal WHERE id = ? FOR UPDATE`, [closing.id])
        const pending = safe(
          api.post(
            `/store/proposals/${closing.id}/votes`,
            { membership_id: memberships[0].id, vote: "for" },
            members[0].headers
          )
        )
        const deadline = Date.now() + 20_000
        for (;;) {
          const { rows } = await pg.raw(
            `SELECT count(*)::int AS n FROM pg_stat_activity
              WHERE datname = current_database() AND pid <> pg_backend_pid() AND wait_event_type = 'Lock'
                AND query LIKE '%UPDATE "garden_proposal"%' AND query LIKE '%"unique_voters" + 1%'`
          )
          if (rows[0].n > 0) break
          if (Date.now() > deadline) throw new Error("the ballot's tally UPDATE never queued behind the finalize")
          await new Promise((resolve) => setTimeout(resolve, 50))
        }
        await finalize.raw(`UPDATE garden_proposal SET status = 'passed', result_calculated_at = now() WHERE id = ?`, [
          closing.id,
        ])
        await finalize.commit()
        late = await pending
      } catch (error) {
        await finalize.rollback().catch(() => undefined)
        throw error
      }
      expect([late.status, late.data?.message]).toEqual([400, "Voting is not open for this proposal"])
      expect(await governance.listGardenVotes({ proposal_id: closing.id })).toHaveLength(0)
      expect(await tally(closing.id)).toEqual(
        expect.objectContaining({ votes_for: "0", total_voting_power: "0", unique_voters: 0 })
      )

      // 4. Past voting_end, the tally write refuses the ballot even when the
      // caller skipped the route's own date check (the service, directly).
      const lapsed = await proposal(`lapsed ${uid()}`)
      await pg.raw(`UPDATE garden_proposal SET voting_end = now() - interval '1 second' WHERE id = ?`, [lapsed.id])
      const lapsedBallot = await governance.castBallot({
        proposal_id: lapsed.id,
        garden_id: gardenId,
        customer_id: members[1].id,
        membership_id: memberships[1].id,
        vote: "for",
        voting_power: 1,
        power_basis: {},
        comment: null,
        comment_visibility: "public",
        is_delegated: false,
        is_final: true,
        voted_at: new Date(),
      })
      expect(lapsedBallot).toEqual({ outcome: "voting_closed" })
      expect(await governance.listGardenVotes({ proposal_id: lapsed.id })).toHaveLength(0)
      expect((await tally(lapsed.id)).unique_voters).toBe(0)
    })
  },
})
