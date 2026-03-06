import { GET, POST } from "./route"

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

describe("admin oracle-keys route", () => {
  it("rejects non-admin actor", async () => {
    const req: any = { auth_context: { actor_type: "user" }, scope: { resolve: jest.fn() } }
    const res = createRes()
    await GET(req, res)
    expect(res.statusCode).toBe(403)
  })

  it("upserts key for admin", async () => {
    const upsertOracleSigningKey = jest.fn().mockResolvedValue({ id: "k_1" })
    const req: any = {
      auth_context: { actor_type: "admin" },
      body: {
        key_id: "k1",
        algorithm: "ed25519",
        public_key_pem: "-----BEGIN PUBLIC KEY-----abc-----END PUBLIC KEY-----",
      },
      scope: { resolve: () => ({ upsertOracleSigningKey }) },
    }
    const res = createRes()
    await POST(req, res)
    expect(res.statusCode).toBe(201)
  })
})
