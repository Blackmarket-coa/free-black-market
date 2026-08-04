import DemandPoolModuleService from "../service"
import { BountyStatus } from "../models/demand-bounty"

describe("DemandPoolModuleService", () => {
  describe("addBounty milestone percentage validation", () => {
    function makeCtx() {
      return {
        listDemandPosts: jest.fn().mockResolvedValue([
          {
            id: "dp_1",
            committed_quantity: 0,
            target_quantity: 10,
            total_bounty_amount: 0,
          },
        ]),
        createDemandBounties: jest
          .fn()
          .mockResolvedValue([{ id: "b_1" }]),
        updateDemandPosts: jest.fn().mockResolvedValue(undefined),
        calculateAttractiveness: jest.fn().mockReturnValue(0),
      }
    }

    it("rejects milestones that do not sum to 100", async () => {
      const ctx: any = makeCtx()

      await expect(
        DemandPoolModuleService.prototype.addBounty.call(ctx, {
          demand_post_id: "dp_1",
          contributor_id: "user_1",
          objective: "FIND_SUPPLIER",
          amount: 100,
          milestones: [
            { description: "a", percentage: 40, condition: "x" },
            { description: "b", percentage: 40, condition: "y" },
          ],
        })
      ).rejects.toThrow("Bounty milestone percentages must sum to 100")

      expect(ctx.createDemandBounties).not.toHaveBeenCalled()
    })

    it("accepts milestones that sum to 100", async () => {
      const ctx: any = makeCtx()

      const bounty = await DemandPoolModuleService.prototype.addBounty.call(
        ctx,
        {
          demand_post_id: "dp_1",
          contributor_id: "user_1",
          objective: "FIND_SUPPLIER",
          amount: 100,
          milestones: [
            { description: "a", percentage: 60, condition: "x" },
            { description: "b", percentage: 40, condition: "y" },
          ],
        }
      )

      expect(ctx.createDemandBounties).toHaveBeenCalledTimes(1)
      expect(bounty).toEqual({ id: "b_1" })
    })

    it.each([
      "CREATOR_NEEDED",
      "MARKETING_NEEDED",
      "PHOTOGRAPHY_NEEDED",
    ])("accepts the %s producer→creator objective", async (objective) => {
      const ctx: any = makeCtx()

      const bounty = await DemandPoolModuleService.prototype.addBounty.call(
        ctx,
        {
          demand_post_id: "dp_1",
          contributor_id: "seller_1",
          contributor_type: "SELLER",
          objective,
          amount: 50,
        }
      )

      expect(bounty).toEqual({ id: "b_1" })
      expect(ctx.createDemandBounties).toHaveBeenCalledTimes(1)
      expect(ctx.createDemandBounties).toHaveBeenCalledWith([
        expect.objectContaining({ objective }),
      ])
    })
  })

  describe("claimBounty", () => {
    it("rejects a second claim once assigned", async () => {
      const bounty: any = {
        id: "b_1",
        assignee_id: null,
        status: BountyStatus.ACTIVE,
      }
      const ctx: any = {
        listDemandBounties: jest.fn(async () => [bounty]),
        updateDemandBounties: jest.fn(async (input: any) => {
          Object.assign(bounty, input)
          return bounty
        }),
      }

      await DemandPoolModuleService.prototype.claimBounty.call(
        ctx,
        "b_1",
        "user_1",
        "CUSTOMER",
        "dp_1"
      )
      expect(bounty.assignee_id).toBe("user_1")

      await expect(
        DemandPoolModuleService.prototype.claimBounty.call(
          ctx,
          "b_1",
          "user_2",
          "CUSTOMER",
          "dp_1"
        )
      ).rejects.toThrow("Bounty already claimed")
    })

    it("scopes the lookup to the pool so a bounty from another pool is unreachable", async () => {
      const updateDemandBounties = jest.fn()
      // Honour the filter, the way the ORM does — a mismatched
      // demand_post_id must yield no rows.
      const ctx: any = {
        listDemandBounties: jest.fn(async (filter: any) =>
          filter.demand_post_id === "dp_owner"
            ? [{ id: "b_victim", assignee_id: null, status: BountyStatus.ACTIVE }]
            : []
        ),
        updateDemandBounties,
      }

      await expect(
        DemandPoolModuleService.prototype.claimBounty.call(
          ctx,
          "b_victim",
          "attacker",
          "CUSTOMER",
          "dp_attacker"
        )
      ).rejects.toThrow("Bounty not found")

      expect(ctx.listDemandBounties).toHaveBeenCalledWith(
        expect.objectContaining({ demand_post_id: "dp_attacker" })
      )
      expect(updateDemandBounties).not.toHaveBeenCalled()
    })
  })

  describe("completeBountyMilestone pool scoping", () => {
    it("refuses a bounty belonging to a different pool and mutates nothing", async () => {
      const raw = jest.fn()
      const updateDemandBounties = jest.fn()
      const ctx: any = {
        listDemandBounties: jest.fn(async (filter: any) =>
          filter.demand_post_id === "dp_owner"
            ? [
                {
                  id: "b_victim",
                  amount: 100,
                  amount_paid_out: 0,
                  milestones_completed: 0,
                  status: BountyStatus.ACTIVE,
                  milestones: [{ description: "m0", percentage: 100, condition: "x" }],
                },
              ]
            : []
        ),
        updateDemandBounties,
        resolvePgConnection: () => ({ raw }),
      }

      await expect(
        DemandPoolModuleService.prototype.completeBountyMilestone.call(
          ctx,
          "b_victim",
          0,
          "dp_attacker"
        )
      ).rejects.toThrow("Bounty not found")

      // The completion UPDATE is committed and irreversible, so it must never
      // be reached for a cross-pool bounty.
      expect(raw).not.toHaveBeenCalled()
      expect(updateDemandBounties).not.toHaveBeenCalled()
    })

    it("constrains the atomic completion UPDATE by demand_post_id", async () => {
      const raw = jest.fn(async () => ({
        rows: [{ milestones_completed: 1, amount_paid_out: 100, status: "COMPLETED" }],
      }))
      const ctx: any = {
        listDemandBounties: jest.fn(async () => [
          {
            id: "b_1",
            amount: 100,
            amount_paid_out: 0,
            milestones_completed: 0,
            status: BountyStatus.ACTIVE,
            milestones: [{ description: "m0", percentage: 100, condition: "x" }],
          },
        ]),
        resolvePgConnection: () => ({ raw }),
      }

      await DemandPoolModuleService.prototype.completeBountyMilestone.call(
        ctx,
        "b_1",
        0,
        "dp_1"
      )

      const [sql, bindings] = raw.mock.calls[0] as unknown as [string, unknown[]]
      expect(sql).toContain("demand_post_id = ?")
      expect(bindings).toContain("dp_1")
    })
  })
})
