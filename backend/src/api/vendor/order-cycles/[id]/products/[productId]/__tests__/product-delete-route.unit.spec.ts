import { DELETE } from "../route"
import { ORDER_CYCLE_MODULE } from "../../../../../../../modules/order-cycle"

/**
 * `DELETE /vendor/order-cycles/:id/products/:productId` did not exist.
 *
 * The vendor panel's `useRemoveOrderCycleProduct` has fetched this exact path
 * since the order-cycle screens shipped, and there was no `DELETE` handler
 * anywhere under `order-cycles` — so the "remove product" button 404'd and
 * showed "Failed to remove product" (`docs/CDFI_COOP_ROADMAP.md` §3.7).
 *
 * The belongs-to assertions below are the point of the suite: this is the
 * third child route on this surface to need one, after the fees route (whose
 * predecessor "deleted by global feeId while ignoring :id entirely") and
 * `exchanges/:exchangeId/products` (fixed 2026-09-08).
 */

// api/vendor/** is inside the TS-3 de-`any`'d ratchet; typed doubles, no `any`.
type TestRes = {
  statusCode: number
  body: unknown
  status: (code: number) => TestRes
  json: (payload: unknown) => TestRes
}

const createRes = (): TestRes => {
  const res = { statusCode: 200, body: undefined } as TestRes
  res.status = (code: number) => {
    res.statusCode = code
    return res
  }
  res.json = (payload: unknown) => {
    res.body = payload
    return res
  }
  return res
}

const CYCLE = {
  id: "oc_1",
  coordinator_seller_id: "sel_coord",
  status: "open",
}
const PRODUCT = { id: "ocp_1", order_cycle_id: "oc_1", seller_id: "sel_member" }

type Overrides = {
  cycle?: Record<string, unknown> | null
  product?: Record<string, unknown> | null
  memberships?: Array<{ seller_id: string; is_active: boolean }>
}

const makeService = (o: Overrides = {}) => ({
  retrieveOrderCycle: jest.fn(async () => {
    if (o.cycle === null) throw new Error("not found")
    return o.cycle ?? CYCLE
  }),
  retrieveOrderCycleProduct: jest.fn(async () => {
    if (o.product === null) throw new Error("not found")
    return o.product ?? PRODUCT
  }),
  listOrderCycleSellers: jest.fn(async () => o.memberships ?? []),
  deleteOrderCycleProducts: jest.fn(async () => undefined),
})

type Service = ReturnType<typeof makeService>

const makeReq = (
  service: Service,
  actorId: string | undefined,
  params: { id: string; productId: string }
) => ({
  params,
  auth_context: actorId ? { actor_id: actorId } : undefined,
  scope: {
    resolve: (key: string) =>
      key === ORDER_CYCLE_MODULE || key === "orderCycleModuleService"
        ? service
        : undefined,
  },
})

type DeleteArgs = Parameters<typeof DELETE>

const callDelete = async (
  service: Service,
  actorId: string | undefined,
  params = { id: "oc_1", productId: "ocp_1" }
) => {
  const res = createRes()
  await DELETE(
    makeReq(service, actorId, params) as unknown as DeleteArgs[0],
    res as unknown as DeleteArgs[1]
  )
  return res
}

const MEMBER = [{ seller_id: "sel_member", is_active: true }]

describe("DELETE /vendor/order-cycles/:id/products/:productId", () => {
  it("401s without an authenticated seller", async () => {
    const service = makeService()
    const res = await callDelete(service, undefined)
    expect(res.statusCode).toBe(401)
    expect(service.deleteOrderCycleProducts).not.toHaveBeenCalled()
  })

  it("404s when the cycle does not exist", async () => {
    const service = makeService({ cycle: null })
    const res = await callDelete(service, "sel_coord")
    expect(res.statusCode).toBe(404)
    expect(service.deleteOrderCycleProducts).not.toHaveBeenCalled()
  })

  it("403s a seller who is neither coordinator nor participant", async () => {
    const service = makeService()
    const res = await callDelete(service, "sel_stranger")
    expect(res.statusCode).toBe(403)
    expect(service.deleteOrderCycleProducts).not.toHaveBeenCalled()
  })

  it("404s when the product belongs to a DIFFERENT cycle", async () => {
    // The bug this route is written to avoid. Without the belongs-to check a
    // coordinator of oc_1 guessing a productId deletes a row out of oc_other.
    const service = makeService({
      product: { id: "ocp_1", order_cycle_id: "oc_other", seller_id: "sel_coord" },
    })
    const res = await callDelete(service, "sel_coord")
    expect(res.statusCode).toBe(404)
    expect(service.deleteOrderCycleProducts).not.toHaveBeenCalled()
  })

  it("404s when the product does not exist", async () => {
    const service = makeService({ product: null })
    const res = await callDelete(service, "sel_coord")
    expect(res.statusCode).toBe(404)
    expect(service.deleteOrderCycleProducts).not.toHaveBeenCalled()
  })

  it("lets the coordinator remove any seller's product", async () => {
    const service = makeService()
    const res = await callDelete(service, "sel_coord")
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ success: true })
    expect(service.deleteOrderCycleProducts).toHaveBeenCalledWith("ocp_1")
  })

  it("lets a participant remove their OWN product", async () => {
    // They added it through the sibling POST, which stamps seller_id from the
    // caller; they must be able to take it back out.
    const service = makeService({ memberships: MEMBER })
    const res = await callDelete(service, "sel_member")
    expect(res.statusCode).toBe(200)
    expect(service.deleteOrderCycleProducts).toHaveBeenCalledWith("ocp_1")
  })

  it("403s a participant removing ANOTHER seller's product", async () => {
    const service = makeService({
      memberships: [
        { seller_id: "sel_member", is_active: true },
        { seller_id: "sel_other", is_active: true },
      ],
      product: { id: "ocp_1", order_cycle_id: "oc_1", seller_id: "sel_member" },
    })
    const res = await callDelete(service, "sel_other")
    expect(res.statusCode).toBe(403)
    expect(service.deleteOrderCycleProducts).not.toHaveBeenCalled()
  })

  it("refuses on a dispatched or cancelled cycle, mirroring the sibling POST", async () => {
    for (const status of ["dispatched", "cancelled"]) {
      const service = makeService({ cycle: { ...CYCLE, status } })
      const res = await callDelete(service, "sel_coord")
      expect(res.statusCode).toBe(400)
      expect(service.deleteOrderCycleProducts).not.toHaveBeenCalled()
    }
  })

  it("still allows removal on a closed cycle, which is not yet dispatched", async () => {
    const service = makeService({ cycle: { ...CYCLE, status: "closed" } })
    const res = await callDelete(service, "sel_coord")
    expect(res.statusCode).toBe(200)
  })

  it("checks authorization before it checks cycle status", async () => {
    // A stranger must not be able to probe a cycle's status through the
    // difference between a 400 and a 403.
    const service = makeService({ cycle: { ...CYCLE, status: "dispatched" } })
    const res = await callDelete(service, "sel_stranger")
    expect(res.statusCode).toBe(403)
  })
})
