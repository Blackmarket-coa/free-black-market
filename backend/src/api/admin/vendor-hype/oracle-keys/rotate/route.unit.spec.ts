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

describe("admin oracle key rotate route", () => {
  it("rotates key with SOP response", async () => {
    const rotateOracleSigningKey = jest.fn().mockResolvedValue({ id: "k_2" })
    const req: any = {
      auth_context: { actor_type: "admin" },
      body: {
        old_key_id: "k1",
        new_key_id: "k2",
        new_public_key_pem: "-----BEGIN PUBLIC KEY-----abc-----END PUBLIC KEY-----",
        rotation_note: "ticket-123 approved",
      },
      scope: { resolve: () => ({ rotateOracleSigningKey }) },
    }
    const res = createRes()
    await POST(req, res)
    expect(res.statusCode).toBe(200)
    expect(res.body.sop).toContain("retire old key")
  })
})
