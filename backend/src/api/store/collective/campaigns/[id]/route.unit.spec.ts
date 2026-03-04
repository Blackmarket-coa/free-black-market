import { PATCH } from "./route"

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

describe("store collective campaigns [id] route", () => {
  it("rejects PATCH when unauthenticated", async () => {
    const service = {
      listCampaigns: jest.fn(),
    }

    const req: any = {
      params: { id: "cc_1" },
      body: { action: "activate" },
      scope: {
        resolve: () => service,
      },
    }

    const res = createRes()
    await PATCH(req, res)

    expect(res.statusCode).toBe(401)
    expect(res.body.error).toBe("Unauthorized")
    expect(service.listCampaigns).not.toHaveBeenCalled()
  })

  it("rejects PATCH when actor is not campaign owner", async () => {
    const service = {
      listCampaigns: jest.fn().mockResolvedValue([{ id: "cc_1", vendor_id: "vendor_2" }]),
    }

    const req: any = {
      params: { id: "cc_1" },
      auth_context: { actor_id: "vendor_1" },
      body: { action: "activate" },
      scope: {
        resolve: () => service,
      },
    }

    const res = createRes()
    await PATCH(req, res)

    expect(service.listCampaigns).toHaveBeenCalledWith({ id: "cc_1" })
    expect(res.statusCode).toBe(403)
    expect(res.body.error).toBe("Forbidden")
  })

  it("returns 400 when transition action omits status", async () => {
    const service = {
      listCampaigns: jest.fn().mockResolvedValue([{ id: "cc_1", vendor_id: "vendor_1" }]),
      transitionCampaignStatus: jest.fn(),
    }

    const req: any = {
      params: { id: "cc_1" },
      auth_context: { actor_id: "vendor_1" },
      body: { action: "transition" },
      scope: {
        resolve: () => service,
      },
    }

    const res = createRes()
    await PATCH(req, res)

    expect(res.statusCode).toBe(400)
    expect(res.body.error).toContain("status is required")
    expect(service.transitionCampaignStatus).not.toHaveBeenCalled()
  })
})
