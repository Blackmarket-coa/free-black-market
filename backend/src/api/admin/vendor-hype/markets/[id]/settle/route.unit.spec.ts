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
        oracle_signature: "c2lnbmF0dXJlX2Jhc2U2NF9sb25nX3NpZ25hdHVyZV9mb3JfdGVzdA==",
        oracle_key_id: "k1",
        oracle_nonce: "nonce_123456789",
        oracle_timestamp: new Date(Date.now() - 60_000).toISOString(),
        oracle_expires_at: new Date(Date.now() + 60_000).toISOString(),
      },
      scope: { resolve: () => ({ emit }) },
      auth_context: { actor_id: "admin_1", actor_type: "admin" },
    }

    const res = createRes()
    await POST(req, res)

    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: "prediction.settlement.requested" })
    )
    expect(res.statusCode).toBe(202)
  })
})
