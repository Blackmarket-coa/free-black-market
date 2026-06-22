import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { HttpTypes } from "@medusajs/types"

vi.mock("@/lib/config", () => ({
  medusaFetch: vi.fn(),
}))

vi.mock("@/lib/data/cookies", () => ({
  getCacheOptions: vi.fn().mockResolvedValue({}),
}))

// regions.ts keeps a module-level `regionMap` cache, so each test re-imports
// the module fresh (via resetModules) to isolate cache state.
type RegionsModule = typeof import("@/lib/data/regions")
type ConfigModule = typeof import("@/lib/config")

let regions: RegionsModule
let config: ConfigModule

const region = (id: string, iso2: string[]): HttpTypes.StoreRegion =>
  ({
    id,
    name: id,
    currency_code: "usd",
    countries: iso2.map((c) => ({ iso_2: c })),
  }) as unknown as HttpTypes.StoreRegion

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  config = await import("@/lib/config")
  regions = await import("@/lib/data/regions")
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("listRegions", () => {
  it("returns the regions array from the fetch", async () => {
    const data = [region("reg_us", ["us"])]
    vi.mocked(config.medusaFetch).mockResolvedValue({ regions: data })

    await expect(regions.listRegions()).resolves.toEqual(data)
    expect(config.medusaFetch).toHaveBeenCalledWith(
      expect.stringContaining("/store/regions"),
      expect.objectContaining({ method: "GET" })
    )
  })

  it("throws (via medusaError) when the fetch rejects", async () => {
    vi.mocked(config.medusaFetch).mockRejectedValue(new Error("boom"))
    await expect(regions.listRegions()).rejects.toThrow()
  })
})

describe("retrieveRegion", () => {
  it("returns the single region", async () => {
    const reg = region("reg_eu", ["de"])
    vi.mocked(config.medusaFetch).mockResolvedValue({ region: reg })

    await expect(regions.retrieveRegion("reg_eu")).resolves.toEqual(reg)
    expect(config.medusaFetch).toHaveBeenCalledWith(
      "/store/regions/reg_eu",
      expect.objectContaining({ method: "GET" })
    )
  })
})

describe("getRegion", () => {
  it("resolves a region by country code and caches subsequent lookups", async () => {
    const reg = region("reg_us", ["us", "ca"])
    vi.mocked(config.medusaFetch).mockResolvedValue({ regions: [reg] })

    await expect(regions.getRegion("us")).resolves.toEqual(reg)
    expect(config.medusaFetch).toHaveBeenCalledTimes(1)

    // Second lookup is served from the in-memory map — no extra fetch.
    await expect(regions.getRegion("ca")).resolves.toEqual(reg)
    expect(config.medusaFetch).toHaveBeenCalledTimes(1)
  })

  it("falls back to the first region when the country has no match", async () => {
    const reg = region("reg_only", ["de"])
    vi.mocked(config.medusaFetch).mockResolvedValue({ regions: [reg] })

    await expect(regions.getRegion("zz")).resolves.toEqual(reg)
  })

  it("returns undefined when no regions exist", async () => {
    vi.mocked(config.medusaFetch).mockResolvedValue({ regions: [] })
    await expect(regions.getRegion("us")).resolves.toBeUndefined()
  })

  it("returns null when the underlying fetch throws", async () => {
    vi.mocked(config.medusaFetch).mockRejectedValue(new Error("network"))
    await expect(regions.getRegion("us")).resolves.toBeNull()
  })
})
