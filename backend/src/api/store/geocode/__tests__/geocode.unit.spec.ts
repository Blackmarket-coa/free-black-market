import { GET as geocode } from "../route"
import { clearBlackoutSpatialCache } from "../../../../lib/blackout-spatial"

/**
 * `GET /store/geocode` (W5): remote-first via the Blackout spatial consumer
 * when enabled, single ZIP3 source as the always-available fallback.
 */

const SPATIAL_ENV = [
  "FBM_BLACKOUT_SPATIAL",
  "BLACKOUT_API_BASE",
  "BLACKOUT_SPATIAL_TOKEN",
] as const
const savedEnv: Record<string, string | undefined> = {}
beforeEach(() => {
  for (const key of SPATIAL_ENV) {
    savedEnv[key] = process.env[key]
    delete process.env[key]
  }
  clearBlackoutSpatialCache()
})
afterEach(() => {
  for (const key of SPATIAL_ENV) {
    if (savedEnv[key] === undefined) delete process.env[key]
    else process.env[key] = savedEnv[key]
  }
})

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

  it("goes remote-first when the Blackout spatial consumer is enabled, ZIP3 when it fails soft", async () => {
    process.env.FBM_BLACKOUT_SPATIAL = "1"
    process.env.BLACKOUT_API_BASE = "https://blackout.test"
    process.env.BLACKOUT_SPATIAL_TOKEN = "spatial-token-xyz"

    const realFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          results: [{ label: "Detroit", latitude: 42.331, longitude: -83.045 }],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )) as typeof fetch
    try {
      const remote = createRes()
      await geocode(makeReq({ postal_code: "48201" }), remote as any)
      expect(remote.statusCode).toBe(200)
      expect(remote.body).toMatchObject({
        latitude: 42.331,
        longitude: -83.045,
        source: "blackout-spatial",
      })

      // Blackout down → the same request still answers from ZIP3.
      clearBlackoutSpatialCache()
      globalThis.fetch = (async () => {
        throw new Error("connect ECONNREFUSED")
      }) as typeof fetch
      const fallback = createRes()
      await geocode(makeReq({ postal_code: "48201" }), fallback as any)
      expect(fallback.statusCode).toBe(200)
      expect(fallback.body.source).toBe("zip3")
    } finally {
      globalThis.fetch = realFetch
    }
  })
})
