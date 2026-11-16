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

import {
  listProducts,
  listProductsWithSort,
  retrieveProductByHandle,
} from "@/lib/data/products"
import { PRODUCT_LIST_FIELDS, PRODUCT_PAGE_FIELDS } from "@/lib/data/product-query"

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

  // From 2026-06-16 this request carried `fields=id,title,handle,thumbnail,
  // status` and no region (an ORM-bug workaround the backend had already
  // fixed), so no card had a price and no product a seller.
  it("asks for the card's fields in the visitor's region", async () => {
    medusaFetch.mockResolvedValue({ products: [], count: 0 })

    await listProducts({ countryCode: "us", queryParams: { limit: 12 } })

    expect(medusaFetch).toHaveBeenCalledTimes(1)
    const [path, options] = medusaFetch.mock.calls[0]
    expect(path).toBe("/store/products")
    expect(options.query).toMatchObject({
      fields: PRODUCT_LIST_FIELDS,
      region_id: "reg_us",
      country_code: "us",
      limit: 12,
      offset: 0,
    })
    expect(options.query.fields).toContain("*variants.calculated_price")
    expect(options.query.fields).toContain("seller.store_status")
  })

  it("sends the region with a caller's own fields when they ask for prices", async () => {
    medusaFetch.mockResolvedValue({ products: [], count: 0 })
    const fields = "*variants.calculated_price,*seller.reviews,-thumbnail"

    await listProducts({
      countryCode: "us",
      queryParams: { fields, handle: ["a", "b"], limit: 2 },
    })

    expect(medusaFetch.mock.calls[0][1].query).toMatchObject({
      fields,
      region_id: "reg_us",
      country_code: "us",
      handle: ["a", "b"],
    })
  })

  it("sends no region with fields that ask for no prices", async () => {
    medusaFetch.mockResolvedValue({ products: [], count: 0 })

    await listProducts({
      countryCode: "us",
      queryParams: { limit: 8, order: "created_at", fields: "id,title,handle" },
    })

    const { query } = medusaFetch.mock.calls[0][1]
    expect(query.fields).toBe("id,title,handle")
    expect(query).not.toHaveProperty("region_id")
    expect(query).not.toHaveProperty("country_code")
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

describe("retrieveProductByHandle", () => {
  const tomatoes = (extra: Record<string, unknown> = {}) =>
    product("prod_tomatoes", {
      handle: "heirloom-tomatoes",
      images: [{ id: "img_1", url: "https://cdn.example.com/tomatoes-1.jpg" }],
      variants: [{ id: "variant_pint", calculated_price: { calculated_amount: 5, currency_code: "usd" } }],
      seller: { id: "sel_1", handle: "riverbend-farm", store_status: "ACTIVE", reviews: [null, { id: "rev_1" }] },
      ...extra,
    })

  it("asks for the page's fields for that handle, in the visitor's region", async () => {
    medusaFetch.mockResolvedValue({ products: [tomatoes()], count: 1 })

    await retrieveProductByHandle({ handle: "heirloom-tomatoes", countryCode: "us" })

    expect(getRegion).toHaveBeenCalledWith("us")
    expect(medusaFetch).toHaveBeenCalledTimes(1)
    const [path, options] = medusaFetch.mock.calls[0]
    expect(path).toBe("/store/products")
    expect(options.method).toBe("GET")
    expect(options.query).toEqual({
      handle: ["heirloom-tomatoes"],
      limit: 1,
      offset: 0,
      region_id: "reg_us",
      country_code: "us",
      fields: PRODUCT_PAGE_FIELDS,
    })
    // What the page cannot sell without.
    for (const field of ["*variants", "*variants.calculated_price", "*variants.options", "*options", "*images"]) {
      expect(options.query.fields.split(",")).toContain(field)
    }
    expect(options.headers).toEqual({ Authorization: "Bearer t" })
  })

  it("returns the product with its variants, images and seller", async () => {
    medusaFetch.mockResolvedValue({ products: [tomatoes()], count: 1 })

    const found = await retrieveProductByHandle({ handle: "heirloom-tomatoes", countryCode: "us" })

    expect(found?.id).toBe("prod_tomatoes")
    expect(found?.variants?.[0].calculated_price?.calculated_amount).toBe(5)
    expect(found?.images?.[0].url).toBe("https://cdn.example.com/tomatoes-1.jpg")
    // A review whose link is gone comes back as null; the seller block maps over them.
    expect(found?.seller?.reviews).toEqual([{ id: "rev_1" }])
  })

  it("returns null for a suspended seller's product", async () => {
    medusaFetch.mockResolvedValue({
      products: [tomatoes({ seller: { id: "sel_1", store_status: "SUSPENDED" } })],
      count: 1,
    })
    await expect(
      retrieveProductByHandle({ handle: "heirloom-tomatoes", countryCode: "us" })
    ).resolves.toBeNull()
  })

  it("returns null when no published product has that handle", async () => {
    medusaFetch.mockResolvedValue({ products: [], count: 0 })
    await expect(retrieveProductByHandle({ handle: "nope", countryCode: "us" })).resolves.toBeNull()
  })

  it("returns null when the region cannot be resolved or the request fails", async () => {
    getRegion.mockResolvedValueOnce(null)
    await expect(retrieveProductByHandle({ handle: "x", countryCode: "zz" })).resolves.toBeNull()
    expect(medusaFetch).not.toHaveBeenCalled()

    medusaFetch.mockRejectedValue(new Error("boom"))
    await expect(retrieveProductByHandle({ handle: "x", countryCode: "us" })).resolves.toBeNull()
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
