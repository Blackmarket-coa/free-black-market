import { POST } from "./route"

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

describe("store collective campaign backings route", () => {
  it("returns 401 for unauthenticated POST", async () => {
    const req: any = {
      params: { id: "cc_1" },
      body: { mode: "PRE_ORDER", amount: 10 },
      scope: { resolve: jest.fn() },
    }

    const res = createRes()
    await POST(req, res)

    expect(res.statusCode).toBe(401)
  })

  it("creates backing for authenticated backer", async () => {
    const service = {
      addBacking: jest.fn().mockResolvedValue({ id: "b_1" }),
    }

    const req: any = {
      params: { id: "cc_1" },
      auth_context: { actor_id: "backer_1" },
      body: { mode: "PRE_ORDER", amount: 10 },
      scope: { resolve: () => service },
    }

    const res = createRes()
    await POST(req, res)

    expect(res.statusCode).toBe(201)
    expect(service.addBacking).toHaveBeenCalledWith(
      expect.objectContaining({ campaign_id: "cc_1", backer_id: "backer_1", amount: 10 })
    )
  })
})
