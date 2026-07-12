import { POST } from "../pos/orders/route"

const createRes = () => {
  const res: any = { statusCode: 200, body: undefined }
  res.status = (code: number) => {
    res.statusCode = code
    return res
  }
  res.json = (payload: unknown) => {
    res.body = payload
    return res
  }
  return res
}

describe("vendor pos orders — auth + validation", () => {
  it("401s without a seller context", async () => {
    const req: any = { body: { items: [{ variant_id: "v", unit_price: 100 }] } }
    const res = createRes()
    await POST(req, res)
    expect(res.statusCode).toBe(401)
  })

  it("400s on an empty payload", async () => {
    const req: any = { body: {}, auth_context: { actor_id: "seller_1" } }
    const res = createRes()
    await POST(req, res)
    expect(res.statusCode).toBe(400)
    expect(res.body.type).toBe("invalid_request")
  })

  it("400s when an item has neither variant_id nor title", async () => {
    const req: any = {
      body: { items: [{ unit_price: 100 }] },
      auth_context: { actor_id: "seller_1" },
    }
    const res = createRes()
    await POST(req, res)
    expect(res.statusCode).toBe(400)
  })

  it("400s on a negative unit_price", async () => {
    const req: any = {
      body: { items: [{ variant_id: "v", unit_price: -5 }] },
      auth_context: { actor_id: "seller_1" },
    }
    const res = createRes()
    await POST(req, res)
    expect(res.statusCode).toBe(400)
  })

  it("prefers the middleware-resolved _seller_id over auth_context", async () => {
    // Reaches the workflow (scope undefined here) — proving auth passed and
    // validation passed; the thrown error is mapped to a 5xx, not a 401/400.
    const req: any = {
      body: { items: [{ variant_id: "v", unit_price: 100 }] },
      _seller_id: "seller_ctx",
      auth_context: undefined,
      scope: undefined,
    }
    const res = createRes()
    await POST(req, res)
    expect(res.statusCode).toBe(500)
  })
})
