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
        // No SQL connection — exercises the read-modify-write fallback.
        resolvePgConnection: () => undefined,
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
        resolvePgConnection: () => undefined,
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

    it("decides the race with an assignee_id IS NULL predicate", async () => {
      const raw = jest.fn(async () => ({ rows: [{ id: "b_1" }] }))
      const ctx: any = {
        listDemandBounties: jest.fn(async () => [
          { id: "b_1", assignee_id: null, status: BountyStatus.ACTIVE },
        ]),
        updateDemandBounties: jest.fn(),
        resolvePgConnection: () => ({ raw }),
      }

      await DemandPoolModuleService.prototype.claimBounty.call(
        ctx,
        "b_1",
        "user_1",
        "CUSTOMER",
        "dp_1"
      )

      const [sql, bindings] = raw.mock.calls[0] as unknown as [string, unknown[]]
      expect(sql).toContain("assignee_id IS NULL")
      expect(sql).toContain("demand_post_id = ?")
      expect(bindings).toEqual(["user_1", "CUSTOMER", "b_1", "dp_1"])
      // The racy read-modify-write path must not be used when SQL is available.
      expect(ctx.updateDemandBounties).not.toHaveBeenCalled()
    })

    it("loses the race gracefully when another claimant got there first", async () => {
      // Row existed at read time, but the guarded UPDATE matched nothing.
      const raw = jest.fn(async () => ({ rows: [] }))
      const ctx: any = {
        listDemandBounties: jest.fn(async () => [
          { id: "b_1", assignee_id: null, status: BountyStatus.ACTIVE },
        ]),
        updateDemandBounties: jest.fn(),
        resolvePgConnection: () => ({ raw }),
      }

      await expect(
        DemandPoolModuleService.prototype.claimBounty.call(
          ctx,
          "b_1",
          "loser",
          "CUSTOMER",
          "dp_1"
        )
      ).rejects.toThrow("Bounty already claimed")

      expect(ctx.updateDemandBounties).not.toHaveBeenCalled()
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

describe("getUnfulfilledDemandLeads", () => {
  const expiredPost = (overrides: any = {}) => ({
    id: "dp_expired",
    status: "EXPIRED",
    category: "grain",
    delivery_region: "midwest",
    committed_quantity: 40,
    target_quantity: 100,
    total_bounty_amount: 250,
    updated_at: "2026-08-01T00:00:00.000Z",
    ...overrides,
  })

  const ctxWith = (posts: any[], proposals: any[] = []) => ({
    listDemandPosts: jest.fn(async () => posts),
    listSupplierProposals: jest.fn(async () => proposals),
  })

  it("queries only EXPIRED public posts", async () => {
    const ctx: any = ctxWith([expiredPost()])

    await DemandPoolModuleService.prototype.getUnfulfilledDemandLeads.call(
      ctx,
      "sel_1"
    )

    const [filters] = ctx.listDemandPosts.mock.calls[0]
    // A CANCELLED pool was withdrawn by its creator and says nothing about
    // whether the market could have been served, so it must not appear.
    expect(filters.status).toBe("EXPIRED")
    expect(filters.visibility).toBe("PUBLIC")
  })

  it("summarises how much demand went unserved", async () => {
    const ctx: any = ctxWith([expiredPost()])

    const leads =
      await DemandPoolModuleService.prototype.getUnfulfilledDemandLeads.call(
        ctx,
        "sel_1"
      )

    expect(leads).toHaveLength(1)
    expect(leads[0].unmet_demand).toEqual({
      committed_quantity: 40,
      target_quantity: 100,
      bounty_amount: 250,
      expired_at: "2026-08-01T00:00:00.000Z",
    })
  })

  it("does not pitch back a pool the supplier already proposed to", async () => {
    const ctx: any = ctxWith(
      [expiredPost(), expiredPost({ id: "dp_other" })],
      [{ demand_post_id: "dp_expired", supplier_id: "sel_1" }]
    )

    const leads =
      await DemandPoolModuleService.prototype.getUnfulfilledDemandLeads.call(
        ctx,
        "sel_1"
      )

    expect(leads.map((l: any) => l.id)).toEqual(["dp_other"])
  })

  it("filters out leads below the requested committed quantity", async () => {
    const ctx: any = ctxWith([
      expiredPost({ id: "dp_small", committed_quantity: 5 }),
      expiredPost({ id: "dp_big", committed_quantity: 500 }),
    ])

    const leads =
      await DemandPoolModuleService.prototype.getUnfulfilledDemandLeads.call(
        ctx,
        "sel_1",
        { min_committed_quantity: 100 }
      )

    expect(leads.map((l: any) => l.id)).toEqual(["dp_big"])
  })

  it("passes category and region through to the query", async () => {
    const ctx: any = ctxWith([])

    await DemandPoolModuleService.prototype.getUnfulfilledDemandLeads.call(
      ctx,
      "sel_1",
      { category: "grain", delivery_region: "midwest" }
    )

    const [filters] = ctx.listDemandPosts.mock.calls[0]
    expect(filters.category).toBe("grain")
    expect(filters.delivery_region).toBe("midwest")
  })
})

describe("setSurplusDisposition", () => {
  const makeCtx = (participant: any) => ({
    listDemandParticipants: jest.fn(async (filter: any) =>
      filter?.id || filter?.customer_id === "cus_1" ? [participant] : []
    ),
    updateDemandParticipants: jest.fn(async (input: any) => {
      Object.assign(participant, input)
      return participant
    }),
  })

  it("records an explicit opt-in", async () => {
    const participant: any = {
      id: "part_1",
      customer_id: "cus_1",
      status: "ESCROWED",
      surplus_disposition: "REFUND",
    }
    const ctx: any = makeCtx(participant)

    await DemandPoolModuleService.prototype.setSurplusDisposition.call(
      ctx,
      "dp_1",
      "cus_1",
      "DONATE"
    )

    expect(participant.surplus_disposition).toBe("DONATE")
  })

  it("is reversible while the escrow is still held", async () => {
    const participant: any = {
      id: "part_1",
      customer_id: "cus_1",
      status: "ESCROWED",
      surplus_disposition: "DONATE",
    }
    const ctx: any = makeCtx(participant)

    // Opting in must not be a one-way door — the guardrail requires the choice
    // stay reversible right up until the money moves.
    await DemandPoolModuleService.prototype.setSurplusDisposition.call(
      ctx,
      "dp_1",
      "cus_1",
      "REFUND"
    )

    expect(participant.surplus_disposition).toBe("REFUND")
  })

  it("refuses to change once the escrow has been released", async () => {
    const participant: any = {
      id: "part_1",
      customer_id: "cus_1",
      status: "REFUNDED",
      surplus_disposition: "REFUND",
    }
    const ctx: any = makeCtx(participant)

    // The money is already gone; pretending the choice still matters would be
    // a lie rather than a courtesy.
    await expect(
      DemandPoolModuleService.prototype.setSurplusDisposition.call(
        ctx,
        "dp_1",
        "cus_1",
        "DONATE"
      )
    ).rejects.toThrow(/already been released/i)

    expect(ctx.updateDemandParticipants).not.toHaveBeenCalled()
  })

  it("rejects a non-participant", async () => {
    const ctx: any = {
      listDemandParticipants: jest.fn(async () => []),
      updateDemandParticipants: jest.fn(),
    }

    await expect(
      DemandPoolModuleService.prototype.setSurplusDisposition.call(
        ctx,
        "dp_1",
        "stranger",
        "DONATE"
      )
    ).rejects.toThrow(/not a participant/i)
  })
})

describe("linkOrderCycle", () => {
  const makeCtx = (post: any) => ({
    listDemandPosts: jest.fn(async () => (post ? [post] : [])),
    updateDemandPosts: jest.fn(async (input: any) => {
      Object.assign(post, input)
      return post
    }),
  })

  it("links the cycle for the selected supplier", async () => {
    const post: any = { id: "dp_1", selected_supplier_id: "sel_winner" }
    const ctx: any = makeCtx(post)

    await DemandPoolModuleService.prototype.linkOrderCycle.call(
      ctx,
      "dp_1",
      "oc_1",
      "sel_winner"
    )

    expect(post.order_cycle_id).toBe("oc_1")
  })

  it("refuses a seller who did not win the pool", async () => {
    const post: any = { id: "dp_1", selected_supplier_id: "sel_winner" }
    const ctx: any = makeCtx(post)

    // Otherwise any seller could capture a buyer group they had no part in
    // winning, overriding what the pool's proposal vote decided.
    await expect(
      DemandPoolModuleService.prototype.linkOrderCycle.call(
        ctx,
        "dp_1",
        "oc_1",
        "sel_interloper"
      )
    ).rejects.toThrow(/only the selected supplier/i)

    expect(ctx.updateDemandPosts).not.toHaveBeenCalled()
  })

  it("refuses a pool that has not selected a supplier yet", async () => {
    const post: any = { id: "dp_1", selected_supplier_id: null }
    const ctx: any = makeCtx(post)

    await expect(
      DemandPoolModuleService.prototype.linkOrderCycle.call(
        ctx,
        "dp_1",
        "oc_1",
        "sel_1"
      )
    ).rejects.toThrow(/no selected supplier/i)

    expect(ctx.updateDemandPosts).not.toHaveBeenCalled()
  })

  it("404s an unknown pool", async () => {
    const ctx: any = makeCtx(null)

    await expect(
      DemandPoolModuleService.prototype.linkOrderCycle.call(
        ctx,
        "dp_missing",
        "oc_1",
        "sel_1"
      )
    ).rejects.toThrow(/not found/i)
  })
})
