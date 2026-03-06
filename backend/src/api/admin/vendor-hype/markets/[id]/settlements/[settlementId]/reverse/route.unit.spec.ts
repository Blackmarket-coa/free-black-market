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

describe("admin reverse settlement route", () => {
  it("rejects non-admin actor", async () => {
    const reverseSettlement = jest.fn()
    const req: any = {
      params: { id: "m_1", settlementId: "set_1" },
      auth_context: { actor_type: "user" },
      body: { reason: "correction needed" },
      scope: { resolve: () => ({ reverseSettlement }) },
    }

    const res = createRes()
    await POST(req, res)

    expect(res.statusCode).toBe(403)
    expect(reverseSettlement).not.toHaveBeenCalled()
  })

  it("reverses settlement for admin", async () => {
    const reverseSettlement = jest.fn().mockResolvedValue({ id: "set_1" })
    const req: any = {
      params: { id: "m_1", settlementId: "set_1" },
      auth_context: { actor_type: "admin", actor_id: "admin_1" },
      body: { reason: "oracle correction", execution_run_id: "run_1" },
      scope: { resolve: () => ({ reverseSettlement }) },
    }

    const res = createRes()
    await POST(req, res)

    expect(reverseSettlement).toHaveBeenCalledWith(
      expect.objectContaining({ market_id: "m_1", settlement_id: "set_1", actor_id: "admin_1" })
    )
    expect(res.statusCode).toBe(200)
  })
})
