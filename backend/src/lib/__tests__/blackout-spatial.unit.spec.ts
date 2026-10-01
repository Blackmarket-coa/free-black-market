import { buildBlackoutSpatialConfig } from "../blackout-spatial-env"
import {
  clearBlackoutSpatialCache,
  geocodePostalCode,
} from "../blackout-spatial"

/**
 * W5: the Blackout spatial consumer — dark behind FBM_BLACKOUT_SPATIAL and
 * strictly fail-soft (every failure resolves to null so callers fall back to
 * the local ZIP3 table; geo never hard-fails a store route).
 */

const ENV_KEYS = [
  "FBM_BLACKOUT_SPATIAL",
  "BLACKOUT_API_BASE",
  "BLACKOUT_SPATIAL_TOKEN",
] as const

const saved: Record<string, string | undefined> = {}
beforeEach(() => {
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key]
    delete process.env[key]
  }
  clearBlackoutSpatialCache()
})
afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
})

const enable = () => {
  process.env.FBM_BLACKOUT_SPATIAL = "1"
  process.env.BLACKOUT_API_BASE = "https://blackout.test/"
  process.env.BLACKOUT_SPATIAL_TOKEN = "spatial-token-xyz"
}

describe("buildBlackoutSpatialConfig", () => {
  it("is null unless flag, base, and token are all present", () => {
    expect(buildBlackoutSpatialConfig({})).toBeNull()
    expect(buildBlackoutSpatialConfig({ FBM_BLACKOUT_SPATIAL: "1" })).toBeNull()
    expect(
      buildBlackoutSpatialConfig({
        FBM_BLACKOUT_SPATIAL: "1",
        BLACKOUT_API_BASE: "https://b.test",
      })
    ).toBeNull()
    expect(
      buildBlackoutSpatialConfig({
        BLACKOUT_API_BASE: "https://b.test",
        BLACKOUT_SPATIAL_TOKEN: "t",
      })
    ).toBeNull()
  })

  it("normalizes the base URL trailing slash", () => {
    expect(
      buildBlackoutSpatialConfig({
        FBM_BLACKOUT_SPATIAL: "true",
        BLACKOUT_API_BASE: "https://b.test///",
        BLACKOUT_SPATIAL_TOKEN: "t",
      })
    ).toEqual({ baseUrl: "https://b.test", token: "t" })
  })
})

describe("geocodePostalCode", () => {
  const realFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = realFetch
  })

  it("returns null (no network call) when disabled", async () => {
    const spy = jest.fn()
    globalThis.fetch = spy as unknown as typeof fetch
    await expect(geocodePostalCode("48201")).resolves.toBeNull()
    expect(spy).not.toHaveBeenCalled()
  })

  it("resolves the first result, sends the service header, and caches", async () => {
    enable()
    const spy = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      expect(url).toBe("https://blackout.test/v1/spatial/geocode?q=48201")
      expect(new Headers(init?.headers).get("x-spatial-token")).toBe(
        "spatial-token-xyz"
      )
      return new Response(
        JSON.stringify({
          results: [
            { label: "Detroit, MI 48201", latitude: 42.33, longitude: -83.05 },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    })
    globalThis.fetch = spy as unknown as typeof fetch

    await expect(geocodePostalCode("48201")).resolves.toEqual({
      latitude: 42.33,
      longitude: -83.05,
      label: "Detroit, MI 48201",
      approximate: true,
    })
    await geocodePostalCode("48201")
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it("fails soft on non-200, network error, and malformed bodies — and does not cache failures", async () => {
    enable()
    let mode: "boom" | "status" | "garbage" | "ok" = "boom"
    const spy = jest.fn(async () => {
      if (mode === "boom") throw new Error("connect ECONNREFUSED")
      if (mode === "status") return new Response("nope", { status: 503 })
      if (mode === "garbage")
        return new Response("not-json", {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      return new Response(JSON.stringify({ results: [] }), { status: 200 })
    })
    globalThis.fetch = spy as unknown as typeof fetch

    await expect(geocodePostalCode("48201")).resolves.toBeNull()
    mode = "status"
    await expect(geocodePostalCode("48201")).resolves.toBeNull()
    mode = "garbage"
    await expect(geocodePostalCode("48201")).resolves.toBeNull()
    // Not cached: a later healthy answer gets through…
    mode = "ok"
    await expect(geocodePostalCode("48201")).resolves.toBeNull() // empty results = null…
    expect(spy).toHaveBeenCalledTimes(4)
    // …but the EMPTY answer (a real "no match") is cached.
    await geocodePostalCode("48201")
    expect(spy).toHaveBeenCalledTimes(4)
  })

  describe("US ZIP consistency with the ZIP3 table", () => {
    const answer = (latitude: number, longitude: number, label = "somewhere") =>
      (jest.fn(async () =>
        new Response(JSON.stringify({ results: [{ label, latitude, longitude }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      ) as unknown) as typeof fetch

    it("drops a foreign-first answer for a US ZIP (94110 → Bavaria) and caches that verdict", async () => {
      enable()
      const spy = answer(48.14, 11.58, "Bayern, Deutschland")
      globalThis.fetch = spy
      await expect(geocodePostalCode("94110")).resolves.toBeNull()
      await expect(geocodePostalCode("94110")).resolves.toBeNull()
      expect(spy).toHaveBeenCalledTimes(1)
    })

    it("keeps an answer inside the ZIP's ZIP3 area", async () => {
      enable()
      globalThis.fetch = answer(37.749, -122.415, "San Francisco, CA 94110")
      await expect(geocodePostalCode("94110")).resolves.toMatchObject({
        latitude: 37.749,
        longitude: -122.415,
      })
    })

    it("checks ZIP+4 by its ZIP", async () => {
      enable()
      globalThis.fetch = answer(45.81, 15.98, "Zagreb")
      await expect(geocodePostalCode("10115-1234")).resolves.toBeNull()
    })

    it("drops a US-shaped ZIP with no ZIP3 entry to check against", async () => {
      enable()
      globalThis.fetch = answer(40.0, -75.0)
      // 000 is not an assigned prefix.
      await expect(geocodePostalCode("00012")).resolves.toBeNull()
    })

    it("passes non-US postal codes through unchecked", async () => {
      enable()
      globalThis.fetch = answer(43.64, -79.39, "Toronto")
      await expect(geocodePostalCode("M5V 2T6")).resolves.toMatchObject({
        latitude: 43.64,
        longitude: -79.39,
      })
    })
  })

  it("skips obviously invalid postals without a call", async () => {
    enable()
    const spy = jest.fn()
    globalThis.fetch = spy as unknown as typeof fetch
    await expect(geocodePostalCode(" 1 ")).resolves.toBeNull()
    expect(spy).not.toHaveBeenCalled()
  })
})
