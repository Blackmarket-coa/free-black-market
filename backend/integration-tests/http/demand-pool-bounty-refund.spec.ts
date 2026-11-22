import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import demandPoolExpiryJob from "../../src/jobs/demand-pool-expiry"
import { DEMAND_POOL_MODULE } from "../../src/modules/demand-pool"
import type DemandPoolModuleService from "../../src/modules/demand-pool/service"
import { HAWALA_LEDGER_MODULE } from "../../src/modules/hawala-ledger"
import type HawalaLedgerModuleService from "../../src/modules/hawala-ledger/service"
import { FUNDED_LAUNCHES_FLAG } from "../../src/modules/hawala-ledger/vendor-transfer-switches"
import { getCollectiveHawalaService } from "../../src/services/collective-hawala"

jest.setTimeout(240 * 1000)

/**
 * A demand pool's ESCROW account holds every participant's purchase money and
 * every bounty's escrow together, so a bounty refund sized by the bounty's
 * `amount` pays an unescrowed bounty out of the participants' money. Measured
 * by the SD-63 re-review on a migrations-built database (the pool's rows could
 * not be inserted before SD-63's migrations): participant B escrowed $100,
 * C added a $60 bounty with nothing escrowed, and the hourly expiry job
 * refunded C $60 out of B's $100 (`PURCHASE/ORDER 100`, then
 * `REFUND/DEMAND_BOUNTY 60`).
 *
 * `refundBountyEscrow` now refunds only an escrowed bounty, at most what its
 * escrow entry moved; an unescrowed one is cancelled with nothing moved.
 * `claimBounty` claims only an ACTIVE, PUBLIC bounty on a pool open for work.
 */
medusaIntegrationTestRunner({
  inApp: true,
  testSuite: ({ getContainer }) => {
    const pg = () => getContainer().resolve(ContainerRegistrationKeys.PG_CONNECTION)
    const pools = () => getContainer().resolve<DemandPoolModuleService>(DEMAND_POOL_MODULE)
    const hawala = () => getContainer().resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)
    const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
    const DAY = 86_400_000

    afterEach(() => {
      delete process.env[FUNDED_LAUNCHES_FLAG]
    })

    /** A customer's USER_WALLET holding `dollars` (a fixture: nothing in the app funds one). */
    async function walletOf(customerId: string, dollars: number) {
      const account = await hawala().createAccount({
        account_type: "USER_WALLET",
        owner_type: "CUSTOMER",
        owner_id: customerId,
        currency_code: "USD",
      })
      await pg().raw(`UPDATE hawala_ledger_account SET balance = ?, available_balance = ? WHERE id = ?`, [
        dollars,
        dollars,
        account.id,
      ])
    }

    /** A published pool (target 10, minimum 5) whose deadline has passed. */
    async function overduePool() {
      const post = await pools().createDemandPost({
        creator_id: `cus_org_${uid()}`,
        title: "Bulk rice",
        description: "A pool for rice.",
        target_quantity: 10,
        min_quantity: 5,
      })
      await pools().publishDemandPost(post.id)
      return post.id as string
    }

    const pastDeadline = (postId: string) =>
      pg().raw(`UPDATE demand_post SET deadline = ? WHERE id = ?`, [new Date(Date.now() - DAY), postId])

    /** Participant B commits `quantity` and escrows $100 from a $100 wallet. */
    async function participantEscrows(postId: string, quantity: number) {
      const b = `cus_b_${uid()}`
      await walletOf(b, 100)
      const participant = await pools().joinDemandPool({ demand_post_id: postId, customer_id: b, quantity_committed: quantity })
      await getCollectiveHawalaService(getContainer()).escrowParticipantFunds({
        demand_post_id: postId,
        participant_id: participant.id,
        customer_id: b,
        amount: 100,
      })
      return b
    }

    /** Balances of these owners' accounts and of the pool's escrow, as `owner|type` -> dollars. */
    async function balances(postId: string, owners: string[]) {
      const { rows } = await pg().raw(
        `SELECT owner_id, account_type, available_balance::text AS available FROM hawala_ledger_account
          WHERE owner_id = ANY(?) ORDER BY owner_id, account_type`,
        [[...owners, `demand-pool-${postId}`]]
      )
      return Object.fromEntries(
        rows.map((r: { owner_id: string; account_type: string; available: string }) => [
          `${r.owner_id === `demand-pool-${postId}` ? "pool" : r.owner_id}|${r.account_type}`,
          Number(r.available),
        ])
      )
    }

    /** Every entry into or out of the pool's escrow, in order. */
    async function poolMoves(postId: string) {
      const { rows } = await pg().raw(
        `SELECT e.entry_type, e.reference_type, e.amount::text AS amount
           FROM hawala_ledger_entry e
           JOIN hawala_ledger_account a ON a.id IN (e.debit_account_id, e.credit_account_id)
          WHERE a.owner_id = ?
          ORDER BY e.created_at, e.id`,
        [`demand-pool-${postId}`]
      )
      return rows.map((r: { entry_type: string; reference_type: string; amount: string }) => [
        r.entry_type,
        r.reference_type,
        Number(r.amount),
      ])
    }

    const statusOf = async (table: "demand_post" | "demand_bounty", id: string) =>
      (await pg().raw(`SELECT status::text AS status FROM "${table}" WHERE id = ?`, [id])).rows[0].status

    it("expiry gives an unescrowed bounty nothing from the participants' escrow (the review's sequence)", async () => {
      const postId = await overduePool()
      const b = await participantEscrows(postId, 5)
      const c = `cus_c_${uid()}`
      await walletOf(c, 0)
      const bounty = await pools().addBounty({ demand_post_id: postId, contributor_id: c, objective: "RECRUIT_BUYERS", amount: 60 })
      await pastDeadline(postId)
      expect(await statusOf("demand_post", postId)).toBe("THRESHOLD_MET")

      await demandPoolExpiryJob(getContainer())

      // Before: C 0 -> 60 and the escrow 100 -> 40, from B's money.
      expect(await balances(postId, [b, c])).toEqual({
        [`${b}|USER_WALLET`]: 0,
        [`${c}|USER_WALLET`]: 0,
        "pool|ESCROW": 100,
      })
      expect(await poolMoves(postId)).toEqual([["PURCHASE", "ORDER", 100]])
      expect(await statusOf("demand_bounty", bounty.id)).toBe("CANCELLED")
      // Not changed here, and recorded in SD-63's row: the job sweeps
      // THRESHOLD_MET pools, which the service cannot expire, so this one
      // stays THRESHOLD_MET and B's $100 stays held.
      expect(await statusOf("demand_post", postId)).toBe("THRESHOLD_MET")
    })

    it("expiry refunds an escrowed bounty at most what it escrowed, gives an unescrowed one nothing, and expires the pool", async () => {
      const postId = await overduePool()
      const b = await participantEscrows(postId, 2)
      const c = `cus_c_${uid()}`
      await walletOf(c, 0)
      const unescrowed = await pools().addBounty({ demand_post_id: postId, contributor_id: c, objective: "RECRUIT_BUYERS", amount: 60 })

      // D's $50 bounty, of which $30 was escrowed: the refund is capped at the 30.
      const d = `cus_d_${uid()}`
      await walletOf(d, 30)
      const escrowed = await pools().addBounty({ demand_post_id: postId, contributor_id: d, objective: "NEGOTIATE_PRICE", amount: 50 })
      process.env[FUNDED_LAUNCHES_FLAG] = "1" // escrowBountyFunds is a funded-launch method; a fixture here
      await getCollectiveHawalaService(getContainer()).escrowBountyFunds({
        demand_post_id: postId,
        bounty_id: escrowed.id,
        contributor_id: d,
        amount: 30,
      })
      delete process.env[FUNDED_LAUNCHES_FLAG]
      await pastDeadline(postId)
      expect(await statusOf("demand_post", postId)).toBe("OPEN")

      await demandPoolExpiryJob(getContainer())

      expect(await balances(postId, [b, c, d])).toEqual({
        [`${b}|USER_WALLET`]: 0,
        [`${c}|USER_WALLET`]: 0,
        [`${d}|USER_WALLET`]: 30,
        "pool|ESCROW": 100,
      })
      expect(await poolMoves(postId)).toEqual([
        ["PURCHASE", "ORDER", 100],
        ["FEE", "DEMAND_BOUNTY", 30],
        ["REFUND", "DEMAND_BOUNTY", 30],
      ])
      expect([await statusOf("demand_bounty", unescrowed.id), await statusOf("demand_bounty", escrowed.id)]).toEqual([
        "CANCELLED",
        "CANCELLED",
      ])
      expect(await statusOf("demand_post", postId)).toBe("EXPIRED")

      // Nothing on the ended pool can be claimed: not a bounty cancelled with
      // it, and not one added to it afterwards.
      const late = await pools().addBounty({ demand_post_id: postId, contributor_id: c, objective: "RECRUIT_BUYERS", amount: 0 })
      for (const id of [unescrowed.id, late.id]) {
        await expect(pools().claimBounty(id, `cus_e_${uid()}`, "CUSTOMER", postId)).rejects.toThrow("Bounty is not open for claims")
      }
    })

    it("a claim takes only an ACTIVE, PUBLIC bounty on a pool open for work", async () => {
      const postId = await overduePool() // published; its deadline is not moved, so nothing expires it
      const open = await pools().addBounty({ demand_post_id: postId, contributor_id: `cus_c_${uid()}`, objective: "RECRUIT_BUYERS", amount: 0 })
      const restricted = await pools().addBounty({
        demand_post_id: postId,
        contributor_id: `cus_c_${uid()}`,
        objective: "RECRUIT_BUYERS",
        amount: 0,
        visibility: "RESTRICTED",
      })

      await expect(pools().claimBounty(restricted.id, `cus_e_${uid()}`, "CUSTOMER", postId)).rejects.toThrow(
        "Bounty is not open for claims"
      )
      const claimant = `cus_e_${uid()}`
      const claimed = await pools().claimBounty(open.id, claimant, "CUSTOMER", postId)
      expect(claimed.assignee_id).toBe(claimant)
      const { rows } = await pg().raw(`SELECT assignee_id FROM demand_bounty WHERE id = ?`, [restricted.id])
      expect(rows[0].assignee_id).toBeNull()
    })
  },
})
