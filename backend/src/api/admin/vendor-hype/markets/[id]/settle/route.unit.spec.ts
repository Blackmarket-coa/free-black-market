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

describe("admin settle prediction market route", () => {
  it("emits settlement requested event", async () => {
    const emit = jest.fn().mockResolvedValue(undefined)
    const req: any = {
      params: { id: "m_1" },
      body: {
        settlement_ref: "set_1",
        oracle_outcome_key: "YES",
        oracle_evidence_uri: "https://oracle.example/evidence/1",
        oracle_payload: { market: "m_1", outcome: "YES" },
        oracle_signature: "sig_abcdef123456",
      },
      scope: { resolve: () => ({ emit }) },
      auth_context: { actor_id: "admin_1" },
    }

    const res = createRes()
    await POST(req, res)

    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: "prediction.settlement.requested" })
    )
    expect(res.statusCode).toBe(202)
  })
})
