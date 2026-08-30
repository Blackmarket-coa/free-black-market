import BuyerNetworkModuleService from "../service"

/**
 * The participation accumulator, wired for the first time by the savings
 * subscriber (Tier 1, docs/SAVINGS_ROUTING_SPEC.md). These pin the split
 * that made it wireable: member counters and network savings accumulate per
 * participant call, while the network's completed-group-buy counter moves
 * only through `recordCompletedGroupBuy` — one pool is one completed group
 * buy, however many participants it had. DI-less fake instance in the same
 * style as the hawala-ledger guard specs.
 */

function buildService(opts?: {
  member?: Record<string, unknown> | null
  network?: Record<string, unknown> | null
}) {
  const svc: any = Object.create(BuyerNetworkModuleService.prototype)

  const member =
    opts?.member === null
      ? null
      : {
          id: "mem_1",
          network_id: "net_1",
          customer_id: "cus_1",
          group_buys_joined: 3,
          total_savings: 100,
          reputation_score: 50,
          reward_points: 40,
          ...opts?.member,
        }
  const network =
    opts?.network === null
      ? null
      : {
          id: "net_1",
          completed_group_buys: 7,
          total_savings: 900,
          ...opts?.network,
        }

  svc.listNetworkMembers = jest.fn(async () => (member ? [member] : []))
  svc.listBuyerNetworks = jest.fn(async () => (network ? [network] : []))
  svc.updateNetworkMembers = jest.fn(async (input: any) => input)
  svc.updateBuyerNetworks = jest.fn(async (input: any) => input)

  return svc
}

describe("recordGroupBuyParticipation", () => {
  it("accumulates member counters and network savings — but never the completed-group-buy count", async () => {
    const svc = buildService()

    await svc.recordGroupBuyParticipation("net_1", "cus_1", 25)

    expect(svc.updateNetworkMembers).toHaveBeenCalledWith({
      id: "mem_1",
      group_buys_joined: 4,
      total_savings: 125,
      reputation_score: 52,
      reward_points: 45,
    })
    expect(svc.updateBuyerNetworks).toHaveBeenCalledTimes(1)
    const networkUpdate = svc.updateBuyerNetworks.mock.calls[0][0]
    expect(networkUpdate).toEqual({ id: "net_1", total_savings: 925 })
    expect(networkUpdate).not.toHaveProperty("completed_group_buys")
  })

  it("caps reputation at 100", async () => {
    const svc = buildService({ member: { reputation_score: 99 } })

    await svc.recordGroupBuyParticipation("net_1", "cus_1", 5)

    expect(
      svc.updateNetworkMembers.mock.calls[0][0].reputation_score
    ).toBe(100)
  })

  it("no-ops for a customer who is not a member", async () => {
    const svc = buildService({ member: null })

    await svc.recordGroupBuyParticipation("net_1", "cus_stranger", 25)

    expect(svc.updateNetworkMembers).not.toHaveBeenCalled()
    expect(svc.updateBuyerNetworks).not.toHaveBeenCalled()
  })
})

describe("recordCompletedGroupBuy", () => {
  it("counts one completed group buy on the network", async () => {
    const svc = buildService()

    await svc.recordCompletedGroupBuy("net_1")

    expect(svc.updateBuyerNetworks).toHaveBeenCalledWith({
      id: "net_1",
      completed_group_buys: 8,
    })
  })

  it("no-ops for an unknown network", async () => {
    const svc = buildService({ network: null })

    await svc.recordCompletedGroupBuy("net_missing")

    expect(svc.updateBuyerNetworks).not.toHaveBeenCalled()
  })
})
