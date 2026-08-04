import { moduleIntegrationTestRunner } from "@medusajs/test-utils"
import { DEMAND_POOL_MODULE } from ".."
import DemandPoolModuleService from "../service"
import {
  DemandPost,
  DemandParticipant,
  DemandBounty,
  SupplierProposal,
  ProposalVote,
} from "../models"

/**
 * Milestone completion under true concurrency — closing one of the two
 * integration-level follow-ups `ECONOMIC_REVIEW.md` left open.
 *
 * The review's B5 finding was that `completeBountyMilestone` read-modify-wrote
 * the milestones JSON with no concurrency guard, so two concurrent calls could
 * both mark the same milestone complete. The fix replaced that with a single
 * atomic UPDATE: `jsonb_set` flips exactly one index, the counters move by
 * `col = col + delta`, and a `WHERE ... completed = false` predicate makes a
 * second completion of the same index update zero rows.
 *
 * That fix is a compare-and-swap expressed as a WHERE clause, and its
 * correctness is *exactly* what a unit test cannot demonstrate: with a mocked
 * repository there is no row, no predicate evaluation, and no contention. The
 * review said as much — "true concurrent-write behavior ... requires a live
 * Postgres harness; tracked as follow-ups rather than claimed under unit
 * coverage." This is that harness.
 *
 * Why it matters beyond tidiness: a double-completion would bump
 * `amount_paid_out` twice for one payout. The payout itself is separately
 * protected by B4's deterministic idempotency key, so money would not move
 * twice — but the bounty's own accounting would claim it had, which is a
 * reconciliation failure that outlives the request that caused it.
 *
 * Requires a database — run with:
 *   TEST_TYPE=integration:modules yarn test:integration:modules \
 *     src/modules/demand-pool/__tests__/milestone-cas.integration.spec.ts
 *
 * Intentionally NOT a *.unit.spec.ts so the DB-less unit suite skips it.
 */
moduleIntegrationTestRunner<DemandPoolModuleService>({
  moduleName: DEMAND_POOL_MODULE,
  // Custom (non-builtin) module: the runner cannot infer the path from
  // ModulesDefinition, so point it at the module directory explicitly.
  resolve: "./src/modules/demand-pool",
  moduleModels: [
    DemandPost,
    DemandParticipant,
    DemandBounty,
    SupplierProposal,
    ProposalVote,
  ],
  testSuite: ({ service }) => {
    async function seedBounty(
      milestones: { description: string; percentage: number; condition: string }[],
      amount = 1000
    ): Promise<{ bountyId: string; postId: string }> {
      const [post] = await (service as any).createDemandPosts([
        {
          creator_id: `creator-${Math.random().toString(36).slice(2)}`,
          title: "Bulk oat order",
          description: "Concurrency fixture",
          target_quantity: 100,
          min_quantity: 10,
        },
      ])

      const bounty = await service.addBounty({
        demand_post_id: post.id,
        contributor_id: `contrib-${Math.random().toString(36).slice(2)}`,
        objective: "FIND_SUPPLIER",
        amount,
        milestones,
      })

      // The post id is returned alongside the bounty because completion is
      // pool-scoped: the caller must prove which pool it is acting on.
      return { bountyId: (bounty as any).id as string, postId: post.id as string }
    }

    // Read straight from Postgres: the completion runs as a raw atomic UPDATE,
    // so MikroORM's identity map would hand back a stale cached row here.
    function pg(): { raw: (sql: string, bindings?: unknown[]) => Promise<any> } {
      const conn = (service as any).resolvePgConnection()
      if (!conn) throw new Error("milestone-cas: no pg connection reachable")
      return conn
    }
    function firstRow(result: any): any {
      return result?.rows?.[0] ?? result?.[0]
    }

    async function readBounty(bountyId: string) {
      const r = await pg().raw(
        `SELECT milestones, milestones_completed, amount_paid_out, status
           FROM demand_bounty WHERE id = ?`,
        [bountyId]
      )
      const row = firstRow(r)
      return {
        milestones: row.milestones as { completed?: boolean }[],
        milestones_completed: Number(row.milestones_completed),
        amount_paid_out: Number(row.amount_paid_out),
        status: String(row.status),
      }
    }

    /**
     * Make the harness schema faithful to production for the column under test.
     *
     * `moduleIntegrationTestRunner` generates its schema from the **model
     * definitions**, and Medusa's `model.enum()` compiles to TEXT + a CHECK
     * constraint. Production's schema comes from the **migrations**, and
     * `Migration20260207CreateDemandPool` declares `status` as a real Postgres
     * enum (`bounty_status_enum`). The atomic UPDATE casts to that type.
     *
     * So the generated schema is missing a type the production statement
     * depends on. That is a harness gap, not a defect in the statement — worth
     * spelling out, because the failure it produces ("type bounty_status_enum
     * does not exist") reads like the cast is wrong when it is exactly right.
     * Recreate the type and convert the column so this test exercises the same
     * statement production runs, against the same column type.
     */
    beforeEach(async () => {
      await pg().raw(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'bounty_status_enum') THEN
            CREATE TYPE "bounty_status_enum" AS ENUM
              ('ACTIVE','MILESTONE_PARTIAL','COMPLETED','CANCELLED','EXPIRED');
          END IF;
        END $$;
      `)
      await pg().raw(
        `ALTER TABLE "demand_bounty" DROP CONSTRAINT IF EXISTS "demand_bounty_status_check";`
      )
      await pg().raw(
        `ALTER TABLE "demand_bounty" ALTER COLUMN "status" DROP DEFAULT;`
      )
      await pg().raw(
        `ALTER TABLE "demand_bounty"
           ALTER COLUMN "status" TYPE "bounty_status_enum"
           USING "status"::text::"bounty_status_enum";`
      )
      await pg().raw(
        `ALTER TABLE "demand_bounty" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';`
      )
    })

    const HALVES = [
      { description: "Deposit", percentage: 50, condition: "on signature" },
      { description: "Delivery", percentage: 50, condition: "on receipt" },
    ]

    describe("demand-pool milestone completion (atomic CAS under contention)", () => {
      it("completes a milestone exactly once under concurrent identical calls", async () => {
        const { bountyId, postId } = await seedBounty(HALVES, 1000)

        // Ten simultaneous attempts at the SAME index. Exactly one may win;
        // the rest must be rejected by the WHERE predicate, not by luck of
        // scheduling.
        const attempts = await Promise.allSettled(
          Array.from({ length: 10 }, () =>
            service.completeBountyMilestone(bountyId, 0, postId)
          )
        )

        const fulfilled = attempts.filter((a) => a.status === "fulfilled")
        const rejected = attempts.filter((a) => a.status === "rejected")

        expect(fulfilled).toHaveLength(1)
        expect(rejected).toHaveLength(9)
        for (const r of rejected as PromiseRejectedResult[]) {
          expect(String(r.reason?.message ?? r.reason)).toMatch(
            /already completed/i
          )
        }

        const after = await readBounty(bountyId)
        // The counters moved exactly once — this is the assertion that would
        // fail under the old read-modify-write.
        expect(after.milestones_completed).toBe(1)
        expect(after.amount_paid_out).toBe(500)
        expect(after.milestones[0].completed).toBe(true)
        expect(after.milestones[1].completed ?? false).toBe(false)
        expect(after.status).toBe("MILESTONE_PARTIAL")
      })

      it("does not let concurrent completions of different indices clobber each other", async () => {
        // The other half of the B5 fix: `jsonb_set` on a single index rather
        // than writing the whole array back. Two whole-array writes would race
        // and one would silently lose its sibling's flag.
        const { bountyId, postId } = await seedBounty(HALVES, 1000)

        const results = await Promise.allSettled([
          service.completeBountyMilestone(bountyId, 0, postId),
          service.completeBountyMilestone(bountyId, 1, postId),
        ])

        expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2)

        const after = await readBounty(bountyId)
        expect(after.milestones_completed).toBe(2)
        expect(after.amount_paid_out).toBe(1000)
        // Neither flag was lost to the other's write.
        expect(after.milestones[0].completed).toBe(true)
        expect(after.milestones[1].completed).toBe(true)
        expect(after.status).toBe("COMPLETED")
      })

      it("never pays out more than the bounty across a full concurrent sweep", async () => {
        // The invariant that actually matters: whatever the interleaving, the
        // sum of milestone payouts equals the bounty amount exactly — never
        // more, which would be an overpayment the escrow cannot fund.
        const quarters = [0, 1, 2, 3].map((i) => ({
          description: `Stage ${i + 1}`,
          percentage: 25,
          condition: "on stage",
        }))
        const { bountyId, postId } = await seedBounty(quarters, 800)

        // Every index attempted three times, all at once.
        const calls = quarters.flatMap((_, index) =>
          Array.from({ length: 3 }, () =>
            service.completeBountyMilestone(bountyId, index, postId)
          )
        )
        const settled = await Promise.allSettled(calls)

        expect(settled.filter((r) => r.status === "fulfilled")).toHaveLength(4)

        const after = await readBounty(bountyId)
        expect(after.milestones_completed).toBe(4)
        expect(after.amount_paid_out).toBe(800)
        expect(after.status).toBe("COMPLETED")
        expect(after.milestones.every((m) => m.completed)).toBe(true)
      })

      it("refuses to complete a milestone once the bounty has left a payable status", async () => {
        // The status predicate is part of the same WHERE clause; a bounty that
        // finished (or was cancelled) mid-flight must stop accepting payouts.
        const { bountyId, postId } = await seedBounty(HALVES, 1000)
        await service.completeBountyMilestone(bountyId, 0, postId)
        await service.completeBountyMilestone(bountyId, 1, postId)

        const after = await readBounty(bountyId)
        expect(after.status).toBe("COMPLETED")

        await expect(
          service.completeBountyMilestone(bountyId, 0, postId)
        ).rejects.toThrow()

        const unchanged = await readBounty(bountyId)
        expect(unchanged.amount_paid_out).toBe(1000)
        expect(unchanged.milestones_completed).toBe(2)
      })

      it("refuses a bounty that belongs to a different pool, and mutates nothing", async () => {
        // Pool scoping is enforced inside the UPDATE's WHERE clause, not just
        // at the route, so it holds against any caller. Proving it here rather
        // than only in a unit test matters because the predicate is SQL: a
        // mocked repository would never evaluate it.
        const victim = await seedBounty(HALVES, 1000)
        const attacker = await seedBounty(HALVES, 1000)

        await expect(
          service.completeBountyMilestone(victim.bountyId, 0, attacker.postId)
        ).rejects.toThrow(/not found/i)

        // The committed UPDATE is irreversible, so "rejected" is only half the
        // claim — the victim's counters must be untouched.
        const after = await readBounty(victim.bountyId)
        expect(after.milestones_completed).toBe(0)
        expect(after.amount_paid_out).toBe(0)
        expect(after.status).toBe("ACTIVE")
        expect(after.milestones[0].completed ?? false).toBe(false)
      })
    })
  },
})
