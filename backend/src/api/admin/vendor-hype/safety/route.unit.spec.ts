import { POST } from "./route"

const createRes = () => {
  const res: any = { statusCode: 200, body: undefined }
  res.status = (code: number) => {
    res.statusCode = code
    return res
  }
  res.json = (payload) => {
    res.body = payload
    return res
  }
  return res
}

describe("admin safety route", () => {
  it("rejects non-admin actor", async () => {
    const req: any = {
      auth_context: { actor_type: "user" },
      body: { supporter_id: "cust_1", daily_position_limit: 5, risk_level: "medium" },
      scope: { resolve: () => ({ upsertUserPredictionSafety: jest.fn() }) },
    }
    const res = createRes()
    await POST(req, res)
    expect(res.statusCode).toBe(403)
  })

  it("upserts safety profile", async () => {
    const upsertUserPredictionSafety = jest.fn().mockResolvedValue({ id: "safe_1" })
    const req: any = {
      auth_context: { actor_type: "admin" },
      body: { supporter_id: "cust_1", daily_position_limit: 5, risk_level: "medium" },
      scope: { resolve: () => ({ upsertUserPredictionSafety }) },
    }
    const res = createRes()
    await POST(req, res)
    expect(res.statusCode).toBe(200)
  })
})
