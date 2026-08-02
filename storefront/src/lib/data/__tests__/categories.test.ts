import { beforeEach, describe, expect, it, vi } from "vitest"

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }))

vi.mock("@/lib/config", () => ({
  sdk: { client: { fetch: fetchMock } },
}))

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import {
  getCategoryByHandle,
  getCollectionByHandle,
  listCategories,
  listCollections,
  listFeaturedCategories,
  listProductTypes,
  listSalesChannels,
} from "@/lib/data/categories"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("listCategories", () => {
  it("splits heading (parent) categories from top-level children", async () => {
    fetchMock.mockResolvedValue({
      product_categories: [
        { name: "Food", parent_category_id: null },
        { name: "Fruit", parent_category_id: null },
        { name: "Apples", parent_category_id: "cat_fruit" },
      ],
    })

    const result = await listCategories({ headingCategories: ["food"] })

    expect(result.parentCategories.map((c) => c.name)).toEqual(["Food"])
    // children excludes the heading category and any with a parent_category_id
    expect(result.categories.map((c) => c.name)).toEqual(["Fruit"])
  })

  it("defaults the limit to 100 in the query", async () => {
    fetchMock.mockResolvedValue({ product_categories: [] })
    await listCategories()
    expect(fetchMock).toHaveBeenCalledWith(
      "/store/product-categories",
      expect.objectContaining({
        query: expect.objectContaining({ limit: 100 }),
      })
    )
  })

  it("fails soft to empty lists when the fetch throws", async () => {
    fetchMock.mockRejectedValue(new Error("backend down"))
    await expect(listCategories()).resolves.toEqual({
      categories: [],
      parentCategories: [],
    })
  })
})

describe("getCategoryByHandle", () => {
  it("joins the handle segments and returns the first match", async () => {
    fetchMock.mockResolvedValue({ product_categories: [{ id: "cat_1" }] })
    const cat = await getCategoryByHandle(["food", "fruit"])
    expect(cat).toEqual({ id: "cat_1" })
    expect(fetchMock).toHaveBeenCalledWith(
      "/store/product-categories",
      expect.objectContaining({
        query: expect.objectContaining({ handle: "food/fruit" }),
      })
    )
  })
})

describe("collections", () => {
  it("listCollections returns the collections array", async () => {
    fetchMock.mockResolvedValue({ collections: [{ id: "col_1" }], count: 1 })
    await expect(listCollections()).resolves.toEqual([{ id: "col_1" }])
  })

  it("getCollectionByHandle returns the first match", async () => {
    fetchMock.mockResolvedValue({ collections: [{ id: "col_1" }] })
    await expect(getCollectionByHandle("summer")).resolves.toEqual({
      id: "col_1",
    })
  })

  it("getCollectionByHandle returns null when empty", async () => {
    fetchMock.mockResolvedValue({ collections: [] })
    await expect(getCollectionByHandle("missing")).resolves.toBeNull()
  })
})

describe("listProductTypes / listSalesChannels (error-tolerant)", () => {
  it("returns product types on success", async () => {
    fetchMock.mockResolvedValue({ product_types: [{ id: "t1", value: "x" }] })
    await expect(listProductTypes()).resolves.toEqual([{ id: "t1", value: "x" }])
  })

  it("returns [] when product types fetch throws", async () => {
    fetchMock.mockRejectedValue(new Error("fail"))
    await expect(listProductTypes()).resolves.toEqual([])
  })

  it("returns sales channels on success and [] on error", async () => {
    fetchMock.mockResolvedValueOnce({ sales_channels: [{ id: "sc1", name: "Web" }] })
    await expect(listSalesChannels()).resolves.toEqual([{ id: "sc1", name: "Web" }])

    fetchMock.mockRejectedValueOnce(new Error("fail"))
    await expect(listSalesChannels()).resolves.toEqual([])
  })
})

describe("listFeaturedCategories", () => {
  it("returns the children categories from listCategories", async () => {
    fetchMock.mockResolvedValue({
      product_categories: [{ name: "Fruit", parent_category_id: null }],
    })
    await expect(listFeaturedCategories()).resolves.toEqual([
      { name: "Fruit", parent_category_id: null },
    ])
  })

  it("returns [] when listCategories throws", async () => {
    fetchMock.mockRejectedValue(new Error("fail"))
    await expect(listFeaturedCategories()).resolves.toEqual([])
  })
})
