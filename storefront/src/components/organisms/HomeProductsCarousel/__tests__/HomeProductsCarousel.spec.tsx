import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import React, { isValidElement, type ReactElement, type ReactNode } from "react"
import type { HttpTypes } from "@medusajs/types"

/**
 * The card row on its two pages. On the home page it fetches the newest
 * products itself; on a product page ("More from this seller") it renders the
 * products it is handed and fetches nothing, so that a card can only ever be
 * a product the listing served.
 *
 * No DOM here: the row (an async server component) is called and the cards
 * read off the element tree it returns.
 */

const h = vi.hoisted(() => ({ medusaFetch: vi.fn() }))

vi.mock("@/lib/config", () => ({ medusaFetch: h.medusaFetch }))
vi.mock("@/lib/data/cookies", () => ({ getAuthHeaders: vi.fn().mockResolvedValue({}) }))
vi.mock("@/lib/data/regions", () => ({
  getRegion: vi.fn().mockResolvedValue({ id: "reg_us", currency_code: "usd" }),
  retrieveRegion: vi.fn(),
}))
vi.mock("@/components/cells", () => ({
  Carousel: ({ items }: { items: ReactNode[] }) => <div>{items}</div>,
}))
vi.mock("../../ProductCard/ProductCard", () => ({
  ProductCard: function ProductCard() {
    return null
  },
}))

import { PRODUCT_LIST_FIELDS } from "@/lib/data/product-query"
import { ProductCard } from "../../ProductCard/ProductCard"
import { HomeProductsCarousel } from "../HomeProductsCarousel"

type CardProps = {
  product: HttpTypes.StoreProduct
  api_product: HttpTypes.StoreProduct
  variant: string
}

const listed = (handle: string, title = handle) =>
  ({
    id: `prod_${handle}`,
    handle,
    title,
    thumbnail: null,
    variants: [{ id: `variant_${handle}`, calculated_price: { calculated_amount: 3, currency_code: "usd" } }],
    seller: { id: "sel_1", name: "Riverbend Farm", handle: "riverbend-farm", store_status: "ACTIVE" },
  }) as unknown as HttpTypes.StoreProduct

const walk = (node: ReactNode, out: ReactElement[] = []): ReactElement[] => {
  if (Array.isArray(node)) {
    node.forEach((child) => walk(child, out))
    return out
  }
  if (!isValidElement(node)) return out
  out.push(node)
  const props = node.props as { children?: ReactNode; items?: ReactNode[] }
  walk(props.children, out)
  walk(props.items, out)
  return out
}

const cardsOf = (row: ReactNode) =>
  walk(row)
    .filter((el) => el.type === ProductCard)
    .map((el) => el.props as CardProps)

describe("HomeProductsCarousel", () => {
  beforeAll(() => {
    // The workspace compiles JSX with the classic runtime under vitest.
    vi.stubGlobal("React", React)
  })
  afterAll(() => {
    vi.unstubAllGlobals()
  })
  beforeEach(() => {
    vi.clearAllMocks()
    h.medusaFetch.mockReset()
  })

  describe("on the home page", () => {
    it("fetches the ten newest products and renders a card for each", async () => {
      h.medusaFetch.mockResolvedValue({ products: [listed("sweet-corn"), listed("basil")], count: 2 })

      const row = await HomeProductsCarousel({ locale: "us", sellerProducts: [], home: true })

      expect(h.medusaFetch).toHaveBeenCalledTimes(1)
      const [path, options] = h.medusaFetch.mock.calls[0]
      expect(path).toBe("/store/products")
      expect(options.query).toMatchObject({
        limit: 10,
        offset: 0,
        order: "created_at",
        fields: PRODUCT_LIST_FIELDS,
        region_id: "reg_us",
        country_code: "us",
      })
      expect(options.query.handle).toBeUndefined()

      const cards = cardsOf(row)
      expect(cards.map((card) => card.product.handle)).toEqual(["sweet-corn", "basil"])
      for (const card of cards) {
        expect(card.api_product).toBe(card.product)
        expect(card.variant).toBe("producer-forward")
      }
    })

    it("leaves out listings that look like placeholders, and renders nothing when none are left", async () => {
      h.medusaFetch.mockResolvedValue({
        products: [listed("sweet-corn"), listed("test-product"), listed("widget", "Sample widget")],
        count: 3,
      })
      const row = await HomeProductsCarousel({ locale: "us", sellerProducts: [], home: true })
      expect(cardsOf(row).map((card) => card.product.handle)).toEqual(["sweet-corn"])

      h.medusaFetch.mockResolvedValue({ products: [], count: 0 })
      await expect(HomeProductsCarousel({ locale: "us", sellerProducts: [], home: true })).resolves.toBeNull()
    })
  })

  describe("on a product page", () => {
    it("renders the products it is given and fetches nothing", async () => {
      const given = [listed("sweet-corn"), listed("basil")]

      const row = await HomeProductsCarousel({ locale: "us", sellerProducts: given, home: false })

      expect(h.medusaFetch).not.toHaveBeenCalled()
      const cards = cardsOf(row)
      expect(cards).toHaveLength(2)
      cards.forEach((card, i) => {
        expect(card.product).toBe(given[i])
        expect(card.api_product).toBe(given[i])
        expect(card.variant).toBe("default")
      })
    })

    // Given no handles, it used to ask the listing with no handle filter and
    // show the newest products of the whole marketplace under "More from
    // this seller".
    it("renders nothing, and fetches nothing, when it is given no products", async () => {
      h.medusaFetch.mockResolvedValue({ products: [listed("newest-on-the-marketplace")], count: 1 })

      await expect(HomeProductsCarousel({ locale: "us", sellerProducts: [], home: false })).resolves.toBeNull()
      expect(h.medusaFetch).not.toHaveBeenCalled()
    })
  })
})
