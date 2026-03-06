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

describe("store vendor hype market positions route", () => {
  it("returns 403 if eligibility flags fail", async () => {
    const req: any = {
      params: { id: "m_1" },
      body: { outcome_option_key: "YES", stake_amount: 10, age_verified: false, self_excluded: false },
      headers: {},
      auth_context: { actor_id: "cust_1", actor_type: "customer" },
      scope: { resolve: () => ({}) },
    }
    const res = createRes()

    await POST(req, res)

    expect(res.statusCode).toBe(403)
  })

  it("returns 400 if idempotency key is missing", async () => {
    const listPredictionMarkets = jest.fn().mockResolvedValue([{ id: "m_1", mode: "cash" }])

    const req: any = {
      params: { id: "m_1" },
      body: {
        outcome_option_key: "YES",
        stake_amount: 10,
        age_verified: true,
        self_excluded: false,
        disclosure_acknowledged: true,
      },
      headers: {},
      auth_context: { actor_id: "cust_1", actor_type: "customer" },
      scope: { resolve: () => ({ listPredictionMarkets }) },
    }
    const res = createRes()

    await POST(req, res)

    expect(res.statusCode).toBe(400)
    expect(res.body.error).toContain("idempotency_key")
  })

  it("uses Idempotency-Key header when body key not provided", async () => {
    const placePredictionPosition = jest.fn().mockResolvedValue({ id: "pos_1" })
    const listPredictionMarkets = jest.fn().mockResolvedValue([{ id: "m_1", mode: "non_cash" }])

    const req: any = {
      params: { id: "m_1" },
      body: {
        outcome_option_key: "YES",
        stake_amount: 10,
        age_verified: true,
        self_excluded: false,
        disclosure_acknowledged: true,
      },
      headers: { "idempotency-key": "idem_hdr" },
      auth_context: { actor_id: "cust_1", actor_type: "customer" },
      scope: { resolve: () => ({ placePredictionPosition, listPredictionMarkets }) },
    }
    const res = createRes()

    await POST(req, res)

    expect(placePredictionPosition).toHaveBeenCalledWith(expect.objectContaining({ idempotency_key: "idem_hdr" }))
    expect(res.statusCode).toBe(201)
  })
})
