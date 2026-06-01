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
        "CUSTOMER"
      )
      expect(bounty.assignee_id).toBe("user_1")

      await expect(
        DemandPoolModuleService.prototype.claimBounty.call(
          ctx,
          "b_1",
          "user_2",
          "CUSTOMER"
        )
      ).rejects.toThrow("Bounty already claimed")
    })
  })
})
