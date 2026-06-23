import { GET } from "./route"

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

describe("admin vendor-hype profiles route contract", () => {
  it("rejects non-admin actor types", async () => {
    const req: any = {
      auth_context: { actor_type: "customer" },
      scope: { resolve: jest.fn() },
    }
    const res = createRes()

    await GET(req, res)

    expect(res.statusCode).toBe(403)
    expect(res.body.error).toBe("Forbidden")
  })
})
