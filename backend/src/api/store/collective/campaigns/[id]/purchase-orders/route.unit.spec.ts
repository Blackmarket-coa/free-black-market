import { GET } from "./route"

const createRes = () => {
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

describe("store collective campaigns [id] purchase-orders route", () => {
  it("rejects unauthenticated requests", async () => {
    const service = {
      listCampaigns: jest.fn(),
      listPurchaseOrders: jest.fn(),
    }

    const req: any = {
      params: { id: "cc_1" },
      scope: { resolve: () => service },
    }

    const res = createRes()
    await GET(req, res)

    expect(res.statusCode).toBe(401)
    expect(service.listCampaigns).not.toHaveBeenCalled()
  })

  it("rejects non-owner vendor", async () => {
    const service = {
      listCampaigns: jest.fn().mockResolvedValue([{ id: "cc_1", vendor_id: "vendor_owner" }]),
      listPurchaseOrders: jest.fn(),
    }

    const req: any = {
      params: { id: "cc_1" },
      auth_context: { actor_id: "vendor_other" },
      scope: { resolve: () => service },
    }

    const res = createRes()
    await GET(req, res)

    expect(res.statusCode).toBe(403)
    expect(service.listPurchaseOrders).not.toHaveBeenCalled()
  })

  it("returns purchase orders for owner vendor", async () => {
    const purchaseOrders = [{ id: "po_1" }]
    const service = {
      listCampaigns: jest.fn().mockResolvedValue([{ id: "cc_1", vendor_id: "vendor_owner" }]),
      listPurchaseOrders: jest.fn().mockResolvedValue(purchaseOrders),
    }

    const req: any = {
      params: { id: "cc_1" },
      auth_context: { actor_id: "vendor_owner" },
      scope: { resolve: () => service },
    }

    const res = createRes()
    await GET(req, res)

    expect(res.statusCode).toBe(200)
    expect(res.body.purchase_orders).toEqual(purchaseOrders)
  })
})
