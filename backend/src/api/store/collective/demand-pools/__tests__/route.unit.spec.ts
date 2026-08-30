import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { POST } from "../route"
import { DEMAND_POOL_MODULE } from "../../../../../modules/demand-pool"
import { BUYER_NETWORK_MODULE } from "../../../../../modules/buyer-network"

/**
 * Populating the demand-post <-> buyer-network link at creation is what
 * makes the link real — it was defined with no writer, so everything
 * downstream (network savings recording, Tier 1 of
 * docs/SAVINGS_ROUTING_SPEC.md) resolved nothing. These pin the membership
 * guard (a post credits its network's stats at completion, so only an
 * active member may attach one), the link write itself, and the
 * partial-failure contract that avoids duplicate posts on retry.
 */

const makeRes = () => {
  const res: any = { statusCode: 200, body: undefined }
  res.status = (code: number) => {
    res.statusCode = code
    return res
  }
  res.json = (payload: any) => {
    res.body = payload
    return res
  }
  return res
}

function makeScope(opts?: { activeMember?: boolean; linkFails?: boolean }) {
  const demandPool = {
    createDemandPost: jest.fn(async () => ({ id: "dp_new", title: "Bulk oats" })),
  }
  const buyerNetwork = {
    listNetworkMembers: jest.fn(async () =>
      opts?.activeMember === false ? [] : [{ id: "mem_1", status: "ACTIVE" }]
    ),
  }
  const remoteLink = {
    create: jest.fn(async () => {
      if (opts?.linkFails) throw new Error("link store down")
      return undefined
    }),
  }

  const scope = {
    resolve: (key: string) => {
      if (key === DEMAND_POOL_MODULE) return demandPool
      if (key === BUYER_NETWORK_MODULE) return buyerNetwork
      if (key === ContainerRegistrationKeys.REMOTE_LINK) return remoteLink
      throw new Error(`Unexpected resolve: ${key}`)
    },
  }
  return { scope, demandPool, buyerNetwork, remoteLink }
}

const baseBody = {
  title: "Bulk oats",
  description: "50lb bags",
  target_quantity: 20,
}

const makeReq = (scope: any, body: Record<string, unknown>) =>
  ({
    body,
    auth_context: { actor_id: "cus_1" },
    scope,
  }) as any

describe("POST /store/collective/demand-pools — buyer network attachment", () => {
  it("links the new post to the network when the creator is an active member", async () => {
    const { scope, buyerNetwork, remoteLink } = makeScope()
    const res = makeRes()

    await POST(makeReq(scope, { ...baseBody, buyer_network_id: "net_1" }), res)

    expect(res.statusCode).toBe(201)
    expect(buyerNetwork.listNetworkMembers).toHaveBeenCalledWith({
      network_id: "net_1",
      customer_id: "cus_1",
      status: "ACTIVE",
    })
    expect(remoteLink.create).toHaveBeenCalledWith({
      [BUYER_NETWORK_MODULE]: { buyer_network_id: "net_1" },
      [DEMAND_POOL_MODULE]: { demand_post_id: "dp_new" },
    })
    expect(res.body.buyer_network_id).toBe("net_1")
  })

  it("refuses a non-member before creating anything", async () => {
    const { scope, demandPool, remoteLink } = makeScope({ activeMember: false })
    const res = makeRes()

    await POST(makeReq(scope, { ...baseBody, buyer_network_id: "net_1" }), res)

    expect(res.statusCode).toBe(400)
    expect(demandPool.createDemandPost).not.toHaveBeenCalled()
    expect(remoteLink.create).not.toHaveBeenCalled()
  })

  it("reports a failed link on the created post instead of erroring — a retry must not duplicate the post", async () => {
    const { scope, demandPool } = makeScope({ linkFails: true })
    const res = makeRes()

    await POST(makeReq(scope, { ...baseBody, buyer_network_id: "net_1" }), res)

    expect(res.statusCode).toBe(201)
    expect(demandPool.createDemandPost).toHaveBeenCalledTimes(1)
    expect(res.body.demand_post.id).toBe("dp_new")
    expect(res.body.network_link_failed).toBe(true)
    expect(res.body.buyer_network_id).toBeNull()
  })

  it("skips the membership check and the link entirely when no network is given", async () => {
    const { scope, buyerNetwork, remoteLink } = makeScope()
    const res = makeRes()

    await POST(makeReq(scope, baseBody), res)

    expect(res.statusCode).toBe(201)
    expect(buyerNetwork.listNetworkMembers).not.toHaveBeenCalled()
    expect(remoteLink.create).not.toHaveBeenCalled()
  })
})
