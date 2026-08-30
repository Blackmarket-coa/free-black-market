import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import savingsDemandPoolFulfilled from "../savings-demand-pool-fulfilled"
import { DEMAND_POOL_MODULE } from "../../modules/demand-pool"
import { BUYER_NETWORK_MODULE } from "../../modules/buyer-network"

/**
 * Tier 1 of docs/SAVINGS_ROUTING_SPEC.md: realized savings are recorded as
 * member/network bookkeeping when a pool is fulfilled. These pin the shape
 * that matters: the savings math and its clamp, the per-participant replay
 * markers (the accumulator itself is not idempotent), the once-per-pool
 * completed-group-buy bump, the no-network no-op, and that a failure is
 * swallowed rather than breaking the fulfillment flow.
 */

type FakeParticipant = {
  id: string
  demand_post_id: string
  customer_id: string
  quantity_committed: number
  status: string
  metadata: Record<string, unknown> | null
}

function makeFixture(opts?: {
  post?: Record<string, unknown> | null
  participants?: FakeParticipant[]
}) {
  const post =
    opts?.post === null
      ? undefined
      : {
          id: "dp_1",
          target_price: 12,
          final_unit_price: 10,
          buyer_network: { id: "net_1" },
          ...opts?.post,
        }

  const participants: FakeParticipant[] = opts?.participants ?? [
    {
      id: "part_a",
      demand_post_id: "dp_1",
      customer_id: "cus_a",
      quantity_committed: 10,
      status: "CONFIRMED",
      metadata: null,
    },
    {
      id: "part_b",
      demand_post_id: "dp_1",
      customer_id: "cus_b",
      quantity_committed: 5,
      status: "ESCROWED",
      metadata: null,
    },
  ]

  const query = {
    graph: jest.fn(async () => ({ data: post ? [post] : [] })),
  }
  const demandPool = {
    listDemandParticipants: jest.fn(async () => [...participants]),
    updateDemandParticipants: jest.fn(async (input: any) => {
      const found = participants.find((p) => p.id === input.id)
      if (found) Object.assign(found, input)
      return found
    }),
  }
  const buyerNetwork = {
    recordGroupBuyParticipation: jest.fn(async () => undefined),
    recordCompletedGroupBuy: jest.fn(async () => undefined),
  }

  const container = {
    resolve: (key: string) => {
      if (key === ContainerRegistrationKeys.QUERY) return query
      if (key === DEMAND_POOL_MODULE) return demandPool
      if (key === BUYER_NETWORK_MODULE) return buyerNetwork
      throw new Error(`Unexpected resolve: ${key}`)
    },
  }

  return { query, demandPool, buyerNetwork, container, participants }
}

const run = (container: any) =>
  savingsDemandPoolFulfilled({
    event: {
      data: {
        demand_post_id: "dp_1",
        organizer_id: "cus_org",
        participant_ids: ["cus_a", "cus_b"],
      },
    },
    container,
  } as any)

describe("savings-demand-pool-fulfilled subscriber", () => {
  it("records clamped per-participant savings and marks each participant", async () => {
    const { buyerNetwork, demandPool, container, participants } = makeFixture()

    await run(container)

    // (12 − 10) × qty
    expect(buyerNetwork.recordGroupBuyParticipation).toHaveBeenCalledWith(
      "net_1",
      "cus_a",
      20
    )
    expect(buyerNetwork.recordGroupBuyParticipation).toHaveBeenCalledWith(
      "net_1",
      "cus_b",
      10
    )
    expect(demandPool.updateDemandParticipants).toHaveBeenCalledTimes(2)
    for (const p of participants) {
      expect(p.metadata).toMatchObject({
        savings_network_id: "net_1",
      })
      expect((p.metadata as any).savings_recorded_at).toBeTruthy()
    }
  })

  it("bumps the network's completed-group-buy counter once per pool, not per participant", async () => {
    const { buyerNetwork, container } = makeFixture()

    await run(container)

    expect(buyerNetwork.recordCompletedGroupBuy).toHaveBeenCalledTimes(1)
    expect(buyerNetwork.recordCompletedGroupBuy).toHaveBeenCalledWith("net_1")
  })

  it("asks only for participants who followed through", async () => {
    const { demandPool, container } = makeFixture()

    await run(container)

    expect(demandPool.listDemandParticipants).toHaveBeenCalledWith({
      demand_post_id: "dp_1",
      status: ["COMMITTED", "ESCROWED", "CONFIRMED"],
    })
  })

  it("no-ops on a redelivered event: marked participants are skipped and the pool is not re-counted", async () => {
    const { buyerNetwork, container } = makeFixture()

    await run(container)
    jest.clearAllMocks()
    await run(container)

    expect(buyerNetwork.recordGroupBuyParticipation).not.toHaveBeenCalled()
    expect(buyerNetwork.recordCompletedGroupBuy).not.toHaveBeenCalled()
  })

  it("resumes a partially-processed delivery without double-recording", async () => {
    const { buyerNetwork, container } = makeFixture({
      participants: [
        {
          id: "part_done",
          demand_post_id: "dp_1",
          customer_id: "cus_done",
          quantity_committed: 10,
          status: "CONFIRMED",
          metadata: { savings_recorded_at: "2026-08-29T00:00:00Z" },
        },
        {
          id: "part_todo",
          demand_post_id: "dp_1",
          customer_id: "cus_todo",
          quantity_committed: 5,
          status: "CONFIRMED",
          metadata: null,
        },
      ],
    })

    await run(container)

    expect(buyerNetwork.recordGroupBuyParticipation).toHaveBeenCalledTimes(1)
    expect(buyerNetwork.recordGroupBuyParticipation).toHaveBeenCalledWith(
      "net_1",
      "cus_todo",
      10
    )
    // The pool still gets its single completion bump on the resuming
    // delivery — the crashed one never reached it.
    expect(buyerNetwork.recordCompletedGroupBuy).toHaveBeenCalledTimes(1)
  })

  it("does nothing for a pool with no linked buyer network", async () => {
    const { buyerNetwork, demandPool, container } = makeFixture({
      post: { buyer_network: null },
    })

    await run(container)

    expect(demandPool.listDemandParticipants).not.toHaveBeenCalled()
    expect(buyerNetwork.recordGroupBuyParticipation).not.toHaveBeenCalled()
    expect(buyerNetwork.recordCompletedGroupBuy).not.toHaveBeenCalled()
  })

  it("records participation with zero savings when prices are missing", async () => {
    const { buyerNetwork, container } = makeFixture({
      post: { final_unit_price: undefined },
    })

    await run(container)

    expect(buyerNetwork.recordGroupBuyParticipation).toHaveBeenCalledWith(
      "net_1",
      "cus_a",
      0
    )
  })

  it("clamps savings at zero when the final price exceeded the target", async () => {
    const { buyerNetwork, container } = makeFixture({
      post: { target_price: 10, final_unit_price: 12 },
    })

    await run(container)

    expect(buyerNetwork.recordGroupBuyParticipation).toHaveBeenCalledWith(
      "net_1",
      "cus_a",
      0
    )
  })

  it("swallows failures — savings bookkeeping must not break fulfillment", async () => {
    const { query, container } = makeFixture()
    query.graph.mockRejectedValueOnce(new Error("graph down"))

    await expect(run(container)).resolves.toBeUndefined()
  })
})
