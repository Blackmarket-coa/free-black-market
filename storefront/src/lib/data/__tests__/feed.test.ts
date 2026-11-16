import { beforeEach, describe, expect, it, vi } from "vitest"

const { medusaFetch, getRegion } = vi.hoisted(() => ({
  medusaFetch: vi.fn(),
  getRegion: vi.fn(),
}))

vi.mock("@/lib/config", () => ({ medusaFetch }))
vi.mock("@/lib/data/cookies", () => ({
  getAuthHeaders: vi.fn().mockResolvedValue({}),
}))
vi.mock("@/lib/data/regions", () => ({ getRegion, retrieveRegion: vi.fn() }))

import { getProductFeed } from "@/lib/data/feed"
import { PRODUCT_FEED_FIELDS, PRODUCT_LIST_FIELDS } from "@/lib/data/product-query"

beforeEach(() => {
  vi.clearAllMocks()
  getRegion.mockResolvedValue({ id: "reg_us" })
})

describe("getProductFeed", () => {
  // A feed item shows the seller's avatar and the product's description
  // (ProductFeedItem reads `seller.photo` and `product.description`); a card
  // shows neither, so the card's list does not ask for them.
  it("asks for the feed's fields, a card's plus the description and the seller's avatar, in the visitor's region", async () => {
    medusaFetch.mockResolvedValue({ products: [], count: 0 })

    await getProductFeed({ countryCode: "us", mode: "recent", limit: 12 })

    expect(medusaFetch).toHaveBeenCalledTimes(1)
    const [path, options] = medusaFetch.mock.calls[0]
    expect(path).toBe("/store/products")
    expect(options.query).toMatchObject({
      fields: PRODUCT_FEED_FIELDS,
      region_id: "reg_us",
      country_code: "us",
      limit: 12,
      order: "-created_at",
    })
    const fields = options.query.fields.split(",")
    expect(fields).toEqual(expect.arrayContaining([...PRODUCT_LIST_FIELDS.split(","), "description", "seller.photo"]))
  })

  it("returns what the listing served, with the avatar and description on it", async () => {
    medusaFetch.mockResolvedValue({
      products: [
        {
          id: "prod_tomatoes",
          title: "Heirloom Tomatoes",
          handle: "heirloom-tomatoes",
          thumbnail: null,
          description: "<p>Vine ripened.</p>",
          seller: { id: "sel_1", name: "Riverbend Farm", photo: "https://cdn.example.com/farm.png", store_status: "ACTIVE" },
        },
      ],
      count: 1,
    })

    const feed = await getProductFeed({ countryCode: "us" })

    expect(feed.totalCount).toBe(1)
    expect(feed.products[0].description).toBe("<p>Vine ripened.</p>")
    expect(feed.products[0].seller?.photo).toBe("https://cdn.example.com/farm.png")
  })
})
