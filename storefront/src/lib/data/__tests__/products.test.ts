import { beforeEach, describe, expect, it, vi } from "vitest"

const { medusaFetch, getRegion, retrieveRegion } = vi.hoisted(() => ({
  medusaFetch: vi.fn(),
  getRegion: vi.fn(),
  retrieveRegion: vi.fn(),
}))

vi.mock("@/lib/config", () => ({ medusaFetch }))

vi.mock("@/lib/data/cookies", () => ({
  getAuthHeaders: vi.fn().mockResolvedValue({ Authorization: "Bearer t" }),
}))

vi.mock("@/lib/data/regions", () => ({ getRegion, retrieveRegion }))

import { listProducts, listProductsWithSort } from "@/lib/data/products"

const product = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  title: id,
  handle: id,
  thumbnail: null,
  ...extra,
})

beforeEach(() => {
  vi.clearAllMocks()
  getRegion.mockResolvedValue({ id: "reg_us" })
  retrieveRegion.mockResolvedValue({ id: "reg_eu" })
})

describe("listProducts", () => {
  it("throws when neither countryCode nor regionId is provided", async () => {
    await expect(listProducts({})).rejects.toThrow(
      "Country code or region ID is required"
    )
  })

  it("returns an empty response when the region cannot be resolved", async () => {
    getRegion.mockResolvedValue(null)
    const res = await listProducts({ countryCode: "us" })
    expect(res).toEqual({ response: { products: [], count: 0 }, nextPage: null })
    expect(medusaFetch).not.toHaveBeenCalled()
  })

  it("resolves the region via retrieveRegion when regionId is given", async () => {
    medusaFetch.mockResolvedValue({ products: [], count: 0 })
    await listProducts({ regionId: "reg_eu" })
    expect(retrieveRegion).toHaveBeenCalledWith("reg_eu")
    expect(getRegion).not.toHaveBeenCalled()
  })

  it("filters out suspended sellers and computes the next page", async () => {
    medusaFetch.mockResolvedValue({
      products: [
        product("p_live", { seller: { id: "s1", store_status: "ACTIVE" } }),
        product("p_suspended", {
          seller: { id: "s2", store_status: "SUSPENDED" },
        }),
        product("p_no_seller"),
      ],
      count: 20,
    })

    const res = await listProducts({ countryCode: "us", queryParams: { limit: 12 } })

    expect(res.response.products.map((p) => p.id)).toEqual([
      "p_live",
      "p_no_seller",
    ])
    expect(res.response.count).toBe(20)
    expect(res.nextPage).toBe(2) // 20 > 0 + 12
  })

  it("returns nextPage null when the count fits on one page", async () => {
    medusaFetch.mockResolvedValue({
      products: [product("p1", { seller: { id: "s", store_status: "ACTIVE" } })],
      count: 5,
    })
    const res = await listProducts({ countryCode: "us", queryParams: { limit: 12 } })
    expect(res.nextPage).toBeNull()
  })

  it("returns a safe empty response when the fetch throws", async () => {
    medusaFetch.mockRejectedValue(new Error("boom"))
    const res = await listProducts({ countryCode: "us" })
    expect(res.response).toEqual({ products: [], count: 0 })
    expect(res.nextPage).toBe(0)
  })
})

describe("listProductsWithSort", () => {
  it("applies the seller_id filter and paginates the sorted results", async () => {
    medusaFetch.mockResolvedValue({
      products: [
        product("p1", {
          seller: { id: "s1", store_status: "ACTIVE" },
          created_at: "2024-01-01",
        }),
        product("p2", {
          seller: { id: "s2", store_status: "ACTIVE" },
          created_at: "2024-02-01",
        }),
      ],
      count: 2,
    })

    const res = await listProductsWithSort({
      countryCode: "us",
      seller_id: "s1",
      page: 1,
      queryParams: { limit: 12 },
    })

    expect(res.response.products.map((p) => p.id)).toEqual(["p1"])
    expect(res.response.count).toBe(1)
  })
})
