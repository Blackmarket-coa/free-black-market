import { expireOverduePools } from "../demand-pool-expiry"

const overduePost = (overrides: Record<string, unknown> = {}) => ({
  id: "dp_1",
  category: "grain",
  delivery_region: "midwest",
  committed_quantity: 40,
  target_quantity: 100,
  total_bounty_amount: 250,
  ...overrides,
})

const makeServices = (posts: Record<string, unknown>[]) => {
  const demandPoolService: any = {
    listDemandPosts: jest.fn(async () => posts),
    transitionDemandStatus: jest.fn(async () => undefined),
  }
  const collectiveHawala: any = {
    refundAllBounties: jest.fn(async () => undefined),
  }
  return { demandPoolService, collectiveHawala }
}

describe("expireOverduePools", () => {
  it("refunds and expires each overdue pool", async () => {
    const { demandPoolService, collectiveHawala } = makeServices([overduePost()])

    const results = await expireOverduePools(
      demandPoolService,
      collectiveHawala,
      new Date()
    )

    expect(collectiveHawala.refundAllBounties).toHaveBeenCalledWith("dp_1")
    expect(demandPoolService.transitionDemandStatus).toHaveBeenCalledWith(
      "dp_1",
      "EXPIRED"
    )
    expect(results).toEqual([{ demand_post_id: "dp_1", status: "expired" }])
  })

  it("announces the unmet demand behind each expired pool", async () => {
    const { demandPoolService, collectiveHawala } = makeServices([overduePost()])
    const onUnfulfilled = jest.fn(async (_signal: any) => undefined)

    await expireOverduePools(
      demandPoolService,
      collectiveHawala,
      new Date(),
      onUnfulfilled
    )

    // Without this the demand signal dies with the pool: an expired pool drops
    // out of every supplier view, so nothing records that a market went
    // unserved.
    expect(onUnfulfilled).toHaveBeenCalledWith({
      demand_post_id: "dp_1",
      category: "grain",
      delivery_region: "midwest",
      committed_quantity: 40,
      target_quantity: 100,
      bounty_amount: 250,
    })
  })

  it("still expires the pool when the announcement fails", async () => {
    const { demandPoolService, collectiveHawala } = makeServices([overduePost()])
    const onUnfulfilled = jest.fn(async () => {
      throw new Error("event bus down")
    })

    const results = await expireOverduePools(
      demandPoolService,
      collectiveHawala,
      new Date(),
      onUnfulfilled
    )

    // The refund and the transition already happened — a failed emit must not
    // report the pool as failed and invite a retry of work that is done.
    expect(results).toEqual([{ demand_post_id: "dp_1", status: "expired" }])
  })

  it("keeps going when one pool fails, and does not announce that one", async () => {
    const { demandPoolService, collectiveHawala } = makeServices([
      overduePost({ id: "dp_bad" }),
      overduePost({ id: "dp_good" }),
    ])
    collectiveHawala.refundAllBounties = jest.fn(async (id: string) => {
      if (id === "dp_bad") throw new Error("refund exploded")
    })
    const onUnfulfilled = jest.fn(async (_signal: any) => undefined)

    const results = await expireOverduePools(
      demandPoolService,
      collectiveHawala,
      new Date(),
      onUnfulfilled
    )

    expect(results).toEqual([
      { demand_post_id: "dp_bad", status: "failed", error: "refund exploded" },
      { demand_post_id: "dp_good", status: "expired" },
    ])
    expect(onUnfulfilled).toHaveBeenCalledTimes(1)
    expect(onUnfulfilled.mock.calls[0][0]).toEqual(
      expect.objectContaining({ demand_post_id: "dp_good" })
    )
  })

  it("works without an emitter at all", async () => {
    const { demandPoolService, collectiveHawala } = makeServices([overduePost()])

    await expect(
      expireOverduePools(demandPoolService, collectiveHawala, new Date())
    ).resolves.toEqual([{ demand_post_id: "dp_1", status: "expired" }])
  })

  it("coerces missing optional fields rather than emitting undefined", async () => {
    const { demandPoolService, collectiveHawala } = makeServices([
      { id: "dp_sparse" },
    ])
    const onUnfulfilled = jest.fn(async (_signal: any) => undefined)

    await expireOverduePools(
      demandPoolService,
      collectiveHawala,
      new Date(),
      onUnfulfilled
    )

    expect(onUnfulfilled).toHaveBeenCalledWith({
      demand_post_id: "dp_sparse",
      category: null,
      delivery_region: null,
      committed_quantity: 0,
      target_quantity: 0,
      bounty_amount: 0,
    })
  })
})
