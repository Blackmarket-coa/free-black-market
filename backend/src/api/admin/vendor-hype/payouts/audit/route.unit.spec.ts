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

describe("admin payout audit route", () => {
  it("rejects non-admin actor", async () => {
    const req: any = {
      auth_context: { actor_type: "user" },
      query: { execution_run_id: "run_1" },
      scope: { resolve: jest.fn() },
    }
    const res = createRes()

    await GET(req, res)

    expect(res.statusCode).toBe(403)
  })

  it("returns payout audit entries for an execution run", async () => {
    const listPredictionPayoutEntries = jest.fn().mockResolvedValue([
      {
        id: "pay_1",
        payout_status: "credited",
        metadata: { payout_processing: { execution_run_id: "run_1" } },
      },
      {
        id: "pay_2",
        payout_status: "failed",
        metadata: { payout_processing: { execution_run_id: "run_1" } },
      },
      {
        id: "pay_3",
        payout_status: "credited",
        metadata: { payout_processing: { execution_run_id: "run_2" } },
      },
    ])

    const req: any = {
      auth_context: { actor_type: "admin" },
      query: { execution_run_id: "run_1" },
      scope: { resolve: () => ({ listPredictionPayoutEntries }) },
    }
    const res = createRes()

    await GET(req, res)

    expect(res.statusCode).toBe(200)
    expect(res.body.summary).toEqual({ total: 2, credited: 1, failed: 1, computed: 0 })
    expect(res.body.payouts).toHaveLength(2)
  })
})
