import { GET as geocode } from "../route"

/**
 * `GET /store/geocode` (W5): the single ZIP3 source behind one route.
 * Route-handler harness; the Blackout remote-first upgrade has its own spec
 * beside the client.
 */

const createRes = () => {
  const res: Record<string, unknown> = { statusCode: 200, body: undefined }
  res.status = (code: number) => {
    res.statusCode = code
    return res
  }
  res.json = (payload: unknown) => {
    res.body = payload
    return res
  }
  return res as {
    statusCode: number
    body: Record<string, any>
    status: (c: number) => unknown
    json: (p: unknown) => unknown
  }
}

const makeReq = (query: Record<string, unknown>) => ({ query }) as any

describe("GET /store/geocode", () => {
  it("resolves a known ZIP prefix with the storefront's historical shape", async () => {
    const res = createRes()
    await geocode(makeReq({ postal_code: "48201" }), res as any)
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({
      zip: "48201",
      approximate: true,
      source: "zip3",
    })
    expect(typeof res.body.latitude).toBe("number")
    expect(typeof res.body.longitude).toBe("number")
  })

  it("accepts the legacy ?zip= alias", async () => {
    const res = createRes()
    await geocode(makeReq({ zip: "10001" }), res as any)
    expect(res.statusCode).toBe(200)
    expect(res.body.zip).toBe("10001")
  })

  it("400s on a too-short code and 404s on an unknown prefix", async () => {
    const short = createRes()
    await geocode(makeReq({ postal_code: "1" }), short as any)
    expect(short.statusCode).toBe(400)

    const unknown = createRes()
    await geocode(makeReq({ postal_code: "000" }), unknown as any)
    expect(unknown.statusCode).toBe(404)
  })
})
