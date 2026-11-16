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
  listMoreFromSeller,
  listProducts,
  listProductsWithSort,
  retrieveProductByHandle,
} from "@/lib/data/products"
import {
  PRODUCT_LIST_FIELDS,
  PRODUCT_PAGE_FIELDS,
  PRODUCT_PAGE_FIELDS_WITHOUT_STOCK,
} from "@/lib/data/product-query"

const product = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  title: id,
  handle: id,
  thumbnail: null,
  ...extra,
})

beforeEach(() => {
  vi.clearAllMocks()
  // Also drops any answer a failed case queued and did not use.
  medusaFetch.mockReset()
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

  // The backend's link returns every product of the seller: drafts and other
  // sales channels' products too. The page hands this object to client
  // components, which serialise it to the browser.
  it("returns the product without the seller's product link", async () => {
    medusaFetch.mockResolvedValue({
      products: [
        tomatoes({
          seller: {
            id: "sel_1",
            name: "Riverbend Farm",
            handle: "riverbend-farm",
            store_status: "ACTIVE",
            reviews: [],
            products: [
              { id: "prod_corn", handle: "sweet-corn", status: "published" },
              { id: "prod_sauce", handle: "unreleased-hot-sauce", status: "draft" },
            ],
          },
        }),
      ],
      count: 1,
    })

    const found = await retrieveProductByHandle({ handle: "heirloom-tomatoes", countryCode: "us" })

    expect(found?.seller).toEqual({
      id: "sel_1",
      name: "Riverbend Farm",
      handle: "riverbend-farm",
      store_status: "ACTIVE",
      reviews: [],
    })
    expect(found?.seller).not.toHaveProperty("products")
    expect(JSON.stringify(found)).not.toContain("unreleased-hot-sauce")
  })

  describe("when the backend refuses the stock count", () => {
    // Medusa answers `variants.inventory_quantity` only when exactly one
    // sales channel resolves; with a publishable key on several it refuses
    // the request: 400, "Inventory availability cannot be calculated in the
    // given context" (pinned in the backend integration spec).
    const refusal = Object.assign(new Error("Inventory availability cannot be calculated in the given context."), {
      status: 400,
    })
    // The same product as the query without the count returns it.
    const uncounted = () =>
      tomatoes({
        variants: [
          {
            id: "variant_pint",
            manage_inventory: true,
            allow_backorder: false,
            calculated_price: { calculated_amount: 5, currency_code: "usd" },
          },
        ],
      })

    it("asks again without it, and returns the product", async () => {
      medusaFetch.mockRejectedValueOnce(refusal).mockResolvedValueOnce({ products: [uncounted()], count: 1 })

      const found = await retrieveProductByHandle({ handle: "heirloom-tomatoes", countryCode: "us" })

      expect(medusaFetch).toHaveBeenCalledTimes(2)
      expect(medusaFetch.mock.calls[0][1].query.fields).toBe(PRODUCT_PAGE_FIELDS)
      expect(medusaFetch.mock.calls[1][1].query).toEqual({
        handle: ["heirloom-tomatoes"],
        limit: 1,
        offset: 0,
        region_id: "reg_us",
        country_code: "us",
        fields: PRODUCT_PAGE_FIELDS_WITHOUT_STOCK,
      })
      expect(medusaFetch.mock.calls[1][1].query.fields).not.toContain("inventory_quantity")
      expect(found?.id).toBe("prod_tomatoes")
      expect(found?.variants?.[0].calculated_price?.calculated_amount).toBe(5)
      expect(found?.variants?.[0]).not.toHaveProperty("inventory_quantity")
    })

    it("returns null when the second request fails too", async () => {
      medusaFetch.mockRejectedValueOnce(refusal).mockRejectedValueOnce(refusal)

      await expect(
        retrieveProductByHandle({ handle: "heirloom-tomatoes", countryCode: "us" })
      ).resolves.toBeNull()
      expect(medusaFetch).toHaveBeenCalledTimes(2)
    })

    it("does not ask again after any other failure", async () => {
      medusaFetch.mockRejectedValueOnce(Object.assign(new Error("Internal Server Error"), { status: 500 }))

      await expect(
        retrieveProductByHandle({ handle: "heirloom-tomatoes", countryCode: "us" })
      ).resolves.toBeNull()
      expect(medusaFetch).toHaveBeenCalledTimes(1)
    })
  })
})

describe("listMoreFromSeller", () => {
  const priced = (amount: number) => [{ id: "v", calculated_price: { calculated_amount: amount, currency_code: "usd" } }]
  const page = (sellerProducts: unknown[]) => ({
    products: [
      product("prod_tomatoes", {
        handle: "heirloom-tomatoes",
        variants: priced(5),
        seller: { id: "sel_1", handle: "riverbend-farm", store_status: "ACTIVE", products: sellerProducts },
      }),
    ],
    count: 1,
  })
  const linked = [
    { id: "prod_corn", handle: "sweet-corn", status: "published" },
    { id: "prod_pallet", handle: "wholesale-pallet", status: "published" },
    { id: "prod_basil", handle: "basil", status: "published" },
    { id: "prod_tomatoes", handle: "heirloom-tomatoes", status: "published" },
    { id: "prod_sauce", handle: "unreleased-hot-sauce", status: "draft" },
  ]
  const card = (id: string, handle: string, variants: unknown[] = priced(3)) =>
    product(id, { handle, variants, seller: { id: "sel_1", name: "Riverbend Farm", store_status: "ACTIVE" } })

  /** Answers the page's query with `pageResponse` and a listing's with `listResponse`. */
  const backend = (pageResponse: unknown, listResponse: unknown) =>
    medusaFetch.mockImplementation(async (_path: string, options: { query: { fields: string } }) =>
      options.query.fields === PRODUCT_PAGE_FIELDS ? pageResponse : listResponse
    )
  const listRequests = () =>
    medusaFetch.mock.calls.filter(([, options]) => options.query.fields !== PRODUCT_PAGE_FIELDS)

  it("asks the listing for the seller's other published products, in the visitor's region", async () => {
    backend(page(linked), { products: [card("prod_corn", "sweet-corn")], count: 1 })

    await listMoreFromSeller({ handle: "heirloom-tomatoes", countryCode: "us" })

    expect(listRequests()).toHaveLength(1)
    const [path, options] = listRequests()[0]
    expect(path).toBe("/store/products")
    expect(options.query).toMatchObject({
      // Not the draft, and not the product being viewed.
      handle: ["sweet-corn", "wholesale-pallet", "basil"],
      fields: PRODUCT_LIST_FIELDS,
      region_id: "reg_us",
      country_code: "us",
      limit: 3,
      offset: 0,
    })
  })

  it("returns only what the listing served: nothing the backend holds back is shown", async () => {
    // The listing serves published products in the storefront's sales
    // channel: the wholesale-only pallet does not come back.
    backend(page(linked), {
      products: [card("prod_basil", "basil"), card("prod_corn", "sweet-corn")],
      count: 2,
    })

    const more = await listMoreFromSeller({ handle: "heirloom-tomatoes", countryCode: "us" })

    expect(more.map((p) => p.handle)).toEqual(["basil", "sweet-corn"])
    expect(more[0].seller?.name).toBe("Riverbend Farm")
    expect(JSON.stringify(more)).not.toContain("wholesale-pallet")
    expect(JSON.stringify(more)).not.toContain("unreleased-hot-sauce")
  })

  it("leaves out the product being viewed, one with no price here, and one it did not ask for", async () => {
    backend(page(linked), {
      products: [
        card("prod_tomatoes", "heirloom-tomatoes"),
        card("prod_basil", "basil", [{ id: "v" }]),
        card("prod_other", "someone-elses-product"),
        card("prod_corn", "sweet-corn"),
      ],
      count: 4,
    })

    const more = await listMoreFromSeller({ handle: "heirloom-tomatoes", countryCode: "us" })

    expect(more.map((p) => p.handle)).toEqual(["sweet-corn"])
  })

  it("shows four at most", async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ id: `prod_${i}`, handle: `p${i}`, status: "published" }))
    backend(page(many), {
      products: many.slice(0, 8).map(({ id, handle }) => card(id, handle)),
      count: 8,
    })

    const more = await listMoreFromSeller({ handle: "heirloom-tomatoes", countryCode: "us" })

    expect(listRequests()[0][1].query.handle).toEqual(["p0", "p1", "p2", "p3", "p4", "p5", "p6", "p7"])
    expect(more.map((p) => p.handle)).toEqual(["p0", "p1", "p2", "p3"])
  })

  it("asks the listing for nothing when the seller has no other published product", async () => {
    backend(
      page([
        { id: "prod_tomatoes", handle: "heirloom-tomatoes", status: "published" },
        { id: "prod_sauce", handle: "unreleased-hot-sauce", status: "draft" },
      ]),
      { products: [card("prod_newest", "newest-on-the-marketplace")], count: 1 }
    )

    await expect(listMoreFromSeller({ handle: "heirloom-tomatoes", countryCode: "us" })).resolves.toEqual([])
    expect(listRequests()).toHaveLength(0)
  })

  it("is empty for a product with no seller, a missing product, or a failed request", async () => {
    backend({ products: [product("prod_tomatoes", { handle: "heirloom-tomatoes" })], count: 1 }, { products: [], count: 0 })
    await expect(listMoreFromSeller({ handle: "heirloom-tomatoes", countryCode: "us" })).resolves.toEqual([])

    backend({ products: [], count: 0 }, { products: [], count: 0 })
    await expect(listMoreFromSeller({ handle: "nope", countryCode: "us" })).resolves.toEqual([])

    medusaFetch.mockReset()
    medusaFetch.mockRejectedValue(new Error("boom"))
    await expect(listMoreFromSeller({ handle: "heirloom-tomatoes", countryCode: "us" })).resolves.toEqual([])
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
