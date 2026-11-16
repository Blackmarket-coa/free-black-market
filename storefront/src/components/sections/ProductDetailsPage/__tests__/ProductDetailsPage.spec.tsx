import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import React, { isValidElement, type ReactElement, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import type { HttpTypes } from "@medusajs/types"

/**
 * The product page, from its fetch to its Add to Cart button, on a product
 * shaped like the backend's real answer.
 *
 * The two fixtures are not hand-written. `product-page-response.json` is the
 * body `GET /store/products` returned for the storefront's product-page query
 * in `backend/integration-tests/http/store-product-page-query.spec.ts` (real
 * Postgres), and `more-from-seller-response.json` is what the listing
 * answered there when asked for that seller's other products; the spec
 * rewrites both when run with PRODUCT_PAGE_FIXTURE_OUT.
 *
 * Two variants of one product: the pint is counted by Medusa and has 7 in
 * stock, the crate is not counted, so it carries no `inventory_quantity` at
 * all. The seller has four more products, and the backend's link returns all
 * of them: sweet corn and basil (no price in the region), a hot sauce still
 * in draft and a pallet sold only through another sales channel. One of the
 * seller's two reviews has no customer.
 *
 * From 2026-06-16 the page fetched `id,title,handle,thumbnail,status` and no
 * region. The last case renders the header on exactly that and shows what a
 * shopper saw: "Not available in your region" and a disabled button, on every
 * product.
 *
 * No DOM in this workspace's vitest: the page (an async server component) is
 * called and its element tree read; the client header and the gallery are
 * rendered through react-dom/server, with the button atom recording its props
 * so the click handler can be called.
 */

const h = vi.hoisted(() => ({
  medusaFetch: vi.fn(),
  addToCart: vi.fn(),
  onAddToCart: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
  searchParams: { current: {} as Record<string, string> },
  cart: { current: null as { items: { variant_id: string; quantity: number }[] } | null },
  buttons: [] as { onClick?: () => unknown; disabled?: boolean; children?: unknown }[],
}))

// The data layer under the page: only the HTTP call is stubbed.
vi.mock("@/lib/config", () => ({ medusaFetch: h.medusaFetch }))
vi.mock("@/lib/data/cookies", () => ({ getAuthHeaders: vi.fn().mockResolvedValue({}) }))
vi.mock("@/lib/data/regions", () => ({
  getRegion: vi.fn().mockResolvedValue({ id: "reg_us", currency_code: "usd" }),
  retrieveRegion: vi.fn(),
}))

// The page's children are read off its tree, not rendered: the organisms
// barrel is most of the storefront.
vi.mock("@/components/organisms", () => ({
  ProductDetails: function ProductDetails() {
    return null
  },
  ProductGallery: function ProductGallery() {
    return null
  },
}))
vi.mock("../../HomeProductSection/HomeProductSection", () => ({
  HomeProductSection: function HomeProductSection() {
    return null
  },
}))
vi.mock("@/app/not-found", () => ({ default: () => null }))

// What the header and the gallery reach through barrels.
vi.mock("@/components/atoms", () => ({
  Button: (props: { onClick?: () => unknown; disabled?: boolean; children?: ReactNode }) => {
    h.buttons.push(props)
    return <button disabled={props.disabled}>{props.children}</button>
  },
  StarRating: ({ rate }: { rate: number }) => <span data-rate={rate} />,
  Chip: ({ value, selected }: { value?: string; selected?: boolean }) => (
    <span data-chip={value} data-selected={String(Boolean(selected))} />
  ),
}))
vi.mock("@/components/molecules", async () => ({
  ProductVariants: (
    await vi.importActual<typeof import("@/components/molecules/ProductVariants/ProductVariants")>(
      "@/components/molecules/ProductVariants/ProductVariants"
    )
  ).ProductVariants,
  ProductCarouselIndicator: () => null,
}))
vi.mock("@/components/cells", async () => ({
  ProductCarousel: (
    await vi.importActual<typeof import("@/components/cells/ProductCarousel/ProductCarousel")>(
      "@/components/cells/ProductCarousel/ProductCarousel"
    )
  ).ProductCarousel,
  // The card row, without the embla carousel around it.
  Carousel: ({ items }: { items: ReactNode[] }) => <div>{items}</div>,
}))
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children?: ReactNode }) => <a href={href}>{children}</a>,
}))
vi.mock("next/navigation", () => ({ useParams: () => ({ locale: "us" }) }))
vi.mock("@/components/providers", () => ({
  useCartContext: () => ({ onAddToCart: h.onAddToCart, cart: h.cart.current }),
}))
vi.mock("@/components/organisms/Chat/Chat", () => ({ Chat: () => null }))
vi.mock("@/components/cells/WishlistButton/WishlistButton", () => ({ WishlistButton: () => null }))
vi.mock("@/hooks/useGetAllSearchParams", () => ({
  default: () => ({ allSearchParams: h.searchParams.current, count: 0 }),
}))
vi.mock("@/hooks/useUpdateSearchParams", () => ({ default: () => vi.fn() }))
vi.mock("@/hooks/useScreenSize", () => ({ useScreenSize: () => "lg" }))
vi.mock("@/lib/data/cart", () => ({ addToCart: h.addToCart }))
vi.mock("@/lib/helpers/toast", () => ({ toast: h.toast }))
vi.mock("next/image", () => ({
  // A plain image element in place of Next's optimiser.
  default: ({ src, alt }: { src: string; alt: string }) => React.createElement("img", { src, alt }),
}))

import response from "./fixtures/product-page-response.json"
import moreFromSellerResponse from "./fixtures/more-from-seller-response.json"
import {
  PRODUCT_LIST_FIELDS,
  PRODUCT_PAGE_FIELDS,
  PRODUCT_PAGE_FIELDS_WITHOUT_STOCK,
} from "@/lib/data/product-query"
import { ProductDetails, ProductGallery as GallerySlot } from "@/components/organisms"
import { ProductGallery } from "@/components/organisms/ProductGallery/ProductGallery"
import { HomeProductsCarousel } from "@/components/organisms/HomeProductsCarousel/HomeProductsCarousel"
import { ProductCard } from "@/components/organisms/ProductCard/ProductCard"
import { ProductDetailsHeader } from "@/components/cells/ProductDetailsHeader/ProductDetailsHeader"
import { SellerInfo } from "@/components/molecules/SellerInfo/SellerInfo"
import type { ProductPageProduct as PageProduct } from "@/lib/data/products"
import type { SellerProps } from "@/types/seller"
import { HomeProductSection } from "../../HomeProductSection/HomeProductSection"
import { ProductDetailsPage } from "../ProductDetailsPage"

const fixture = response.products[0]
const variantId = (sku: string) => {
  const found = fixture.variants.find((v) => v.sku === sku)
  if (!found) throw new Error(`fixture has no ${sku}`)
  return found.id
}
const PINT = variantId("TOM-PINT")
const CRATE = variantId("TOM-CRATE")

const walk = (node: ReactNode, out: ReactElement[] = []): ReactElement[] => {
  if (Array.isArray(node)) {
    node.forEach((child) => walk(child, out))
    return out
  }
  if (!isValidElement(node)) return out
  out.push(node)
  walk((node.props as { children?: ReactNode }).children, out)
  return out
}

/**
 * The page as the route renders it, and the props it hands its parts: the
 * gallery, the details (which pass the product whole to client components)
 * and, when there is one, the "More from this seller" section.
 */
async function renderPage() {
  const tree = await ProductDetailsPage({ handle: "heirloom-tomatoes", locale: "us" })
  const elements = walk(tree)
  const gallery = elements.find((el) => el.type === GallerySlot)
  const details = elements.find((el) => el.type === ProductDetails)
  const section = elements.find((el) => el.type === HomeProductSection)
  if (!gallery || !details) throw new Error("the page rendered no gallery or no details")
  return {
    images: (gallery.props as { images: HttpTypes.StoreProduct["images"] }).images,
    product: (details.props as { product: PageProduct }).product,
    moreFromSeller: section?.props as { heading: string; products: HttpTypes.StoreProduct[] } | undefined,
  }
}

type FetchOptions = { query: { fields: string; handle?: string[] } }

/** The requests the page made for products, by the field list they carried. */
const productRequests = (fields: string) =>
  (h.medusaFetch.mock.calls as [string, FetchOptions][]).filter(
    ([path, options]) => path === "/store/products" && options.query.fields === fields
  )

/** What the fixture's seller is linked to that no shopper may be shown. */
const linkedTo = (handle: string) => {
  const stub = fixture.seller.products.find((p) => p.handle === handle)
  if (!stub) throw new Error(`the fixture's seller is not linked to ${handle}`)
  return stub
}

/** The header's markup, and its main Add to Cart button (the first it renders). */
function renderHeader(product: PageProduct, chosen: Record<string, string> = {}) {
  h.buttons.length = 0
  h.searchParams.current = chosen
  const html = renderToStaticMarkup(
    <ProductDetailsHeader product={product} locale="us" user={null} wishlist={[]} />
  )
  const [addToCartButton] = h.buttons
  return { html, addToCartButton }
}

describe("the product page on a real /store/products response", () => {
  beforeAll(() => {
    // The workspace compiles JSX with the classic runtime under vitest.
    vi.stubGlobal("React", React)
  })
  afterAll(() => {
    vi.unstubAllGlobals()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    h.cart.current = null
    h.searchParams.current = {}
    h.addToCart.mockResolvedValue(undefined)
    h.medusaFetch.mockImplementation(async (path: string, options: FetchOptions) => {
      if (path.endsWith("/listing-type")) return { catalog_id: null }
      if (path !== "/store/products") throw new Error(`unexpected request ${path}`)
      // The backend as the integration spec recorded it: the page's query,
      // and the listing asked for the seller's other products.
      if (options.query.fields === PRODUCT_PAGE_FIELDS) return response
      if (options.query.fields === PRODUCT_LIST_FIELDS) return moreFromSellerResponse
      throw new Error(`unexpected product query ${options.query.fields}`)
    })
  })

  it("fetches the product with the page's fields in the visitor's region", async () => {
    await renderPage()

    // Once for the product and once for its seller's other products; the
    // same request, which Next serves from its cache the second time.
    const requests = productRequests(PRODUCT_PAGE_FIELDS)
    expect(requests.length).toBeGreaterThanOrEqual(1)
    for (const [, options] of requests) {
      expect(options.query).toEqual({
        handle: ["heirloom-tomatoes"],
        limit: 1,
        offset: 0,
        region_id: "reg_us",
        country_code: "us",
        fields: PRODUCT_PAGE_FIELDS,
      })
    }
  })

  // The backend's seller link returns every product of the seller. The page
  // hands the product whole to `ProductDetails`, whose header is a client
  // component: whatever is on it is serialised into the page.
  it("hands the client no list of the seller's products: not the draft, not another channel's", async () => {
    // The real response does carry them.
    expect(linkedTo("unreleased-hot-sauce").status).toBe("draft")
    expect(linkedTo("wholesale-pallet").status).toBe("published")

    const { product } = await renderPage()

    expect(product.seller).toMatchObject({ name: "Riverbend Farm", handle: "riverbend-farm" })
    expect(product.seller).not.toHaveProperty("products")
    const sentToTheBrowser = JSON.stringify(product)
    for (const handle of ["unreleased-hot-sauce", "wholesale-pallet", "basil", "sweet-corn"]) {
      expect(sentToTheBrowser).not.toContain(handle)
      expect(sentToTheBrowser).not.toContain(linkedTo(handle).id)
    }
  })

  it("shows under \"More from this seller\" only what the listing served, never the linked stubs", async () => {
    const { moreFromSeller } = await renderPage()

    // The listing was asked for the seller's other published products, not
    // for the draft and not for the product being viewed.
    const [listRequest] = productRequests(PRODUCT_LIST_FIELDS)
    expect(productRequests(PRODUCT_LIST_FIELDS)).toHaveLength(1)
    expect(listRequest[1].query).toMatchObject({ region_id: "reg_us", country_code: "us" })
    expect([...(listRequest[1].query.handle ?? [])].sort()).toEqual(["basil", "sweet-corn", "wholesale-pallet"])

    // It served the two in the storefront's channel; basil has no price in
    // the region, so one card.
    expect(moreFromSeller?.heading).toBe("More from this seller")
    expect(moreFromSeller?.products.map((p) => p.handle)).toEqual(["sweet-corn"])
    const sentToTheBrowser = JSON.stringify(moreFromSeller?.products)
    for (const handle of ["unreleased-hot-sauce", "wholesale-pallet", "heirloom-tomatoes"]) {
      expect(sentToTheBrowser).not.toContain(handle)
    }

    // The row renders one card per product it was given, from that product.
    const row = await HomeProductsCarousel({
      locale: "us",
      sellerProducts: moreFromSeller?.products ?? [],
      home: false,
    })
    const cards = walk(row).flatMap((el) =>
      walk((el.props as { items?: ReactNode[] }).items ?? []).filter((item) => item.type === ProductCard)
    )
    expect(cards).toHaveLength(1)
    const card = cards[0].props as { product: HttpTypes.StoreProduct; api_product: HttpTypes.StoreProduct }
    expect(card.product).toBe(moreFromSeller?.products[0])
    expect(card.api_product).toBe(moreFromSeller?.products[0])

    const html = renderToStaticMarkup(<ProductCard {...card} />)
    expect(html).toContain("Sweet Corn")
    expect(html).toContain("$3.00")
    expect(html).toContain('href="/us/products/sweet-corn"')
    // The card names the seller, which the listing's product carries.
    expect(html).toContain("Riverbend Farm")
    expect(html).not.toContain("Community Vendor")
  })

  it("renders no \"More from this seller\" section when the listing serves none of the seller's other products", async () => {
    h.medusaFetch.mockImplementation(async (path: string, options: FetchOptions) => {
      if (path.endsWith("/listing-type")) return { catalog_id: null }
      if (options.query.fields === PRODUCT_PAGE_FIELDS) return response
      return { products: [], count: 0 }
    })

    const { moreFromSeller, product } = await renderPage()

    expect(product.id).toBe(fixture.id)
    expect(moreFromSeller).toBeUndefined()
  })

  it("renders the seller block when a review has no customer", async () => {
    // As the backend returns a review whose customer is gone: no `customer`
    // key at all.
    const orphan = fixture.seller.reviews.find((r) => r.customer_note === "Fresh and sweet")
    expect(orphan).toBeDefined()
    expect(orphan).not.toHaveProperty("customer")

    const { product } = await renderPage()
    const html = renderToStaticMarkup(<SellerInfo seller={product.seller as SellerProps} />)

    expect(html).toContain("Riverbend Farm")
    expect(html).toContain("2 reviews")
    expect(html).toContain("Ada Buyer")
    expect(html).toContain("Great tomatoes")
    expect(html).toContain("Verified buyer")
    expect(html).toContain("Fresh and sweet")
  })

  it("hands the gallery the product's images, and the gallery renders them", async () => {
    const { images } = await renderPage()

    expect(images?.map((image) => image.url)).toEqual([
      "https://cdn.example.com/tomatoes-1.jpg",
      "https://cdn.example.com/tomatoes-2.jpg",
    ])
    const html = renderToStaticMarkup(<ProductGallery images={images} />)
    expect(html).toContain('<img src="https://cdn.example.com/tomatoes-1.jpg"')
    expect(html).toContain('<img src="https://cdn.example.com/tomatoes-2.jpg"')
  })

  it("renders the price and the option picker, with Add to Cart enabled on the cheapest variant", async () => {
    const { product } = await renderPage()

    const { html, addToCartButton } = renderHeader(product)

    expect(html).toContain("Heirloom Tomatoes")
    expect(html).toContain("$5.00")
    expect(html).not.toContain("Not available in your region")
    expect(html).toContain("ADD TO CART")
    expect(html).not.toContain("OUT OF STOCK")
    expect(addToCartButton.disabled).toBe(false)
    // Both sizes offered, the cheapest chosen.
    expect(html).toContain('data-chip="Pint" data-selected="true"')
    expect(html).toContain('data-chip="Crate" data-selected="false"')
  })

  it("adds the chosen variant to the cart when the button is pressed", async () => {
    const { product } = await renderPage()
    const { addToCartButton } = renderHeader(product)

    await addToCartButton.onClick?.()

    expect(h.addToCart).toHaveBeenCalledTimes(1)
    expect(h.addToCart).toHaveBeenCalledWith({ variantId: PINT, quantity: 1, countryCode: "us" })
    expect(h.onAddToCart).toHaveBeenCalledWith(
      expect.objectContaining({ variant_id: PINT, product_id: fixture.id, quantity: 1, total: 5, subtotal: 5 }),
      "usd"
    )
    expect(h.toast.success).toHaveBeenCalledTimes(1)
    expect(h.toast.error).not.toHaveBeenCalled()
  })

  it("sells a variant Medusa does not count: no quantity in the response is not zero in stock", async () => {
    const { product } = await renderPage()
    const crate = product.variants?.find((v) => v.id === CRATE)
    expect(crate?.manage_inventory).toBe(false)
    expect(crate).not.toHaveProperty("inventory_quantity")

    const { html, addToCartButton } = renderHeader(product, { size: "Crate" })

    expect(html).toContain("$40.00")
    expect(html).toContain("ADD TO CART")
    expect(html).not.toContain("OUT OF STOCK")
    expect(addToCartButton.disabled).toBe(false)

    await addToCartButton.onClick?.()
    expect(h.addToCart).toHaveBeenCalledWith({ variantId: CRATE, quantity: 1, countryCode: "us" })
  })

  it("keeps a counted variant with none left out of stock", async () => {
    const { product } = await renderPage()
    const soldOut: PageProduct = {
      ...product,
      variants: product.variants?.map((v) => (v.id === PINT ? { ...v, inventory_quantity: 0 } : v)) ?? null,
    }

    const { html, addToCartButton } = renderHeader(soldOut, { size: "Pint" })

    expect(html).toContain("OUT OF STOCK")
    expect(addToCartButton.disabled).toBe(true)
  })

  // Medusa answers the stock count only for a publishable key on exactly one
  // sales channel, and refuses the whole request otherwise (pinned in the
  // backend spec, where the query without the count returns the counted pint
  // as `manage_inventory: true` with no `inventory_quantity`).
  it("still sells when the backend refuses the stock count: the page asks again without it", async () => {
    const withoutCounts = {
      ...response,
      products: response.products.map((p) => ({
        ...p,
        variants: p.variants.map((v) => {
          const variant: Record<string, unknown> = { ...v }
          delete variant.inventory_quantity
          return variant
        }),
      })),
    }
    h.medusaFetch.mockImplementation(async (path: string, options: FetchOptions) => {
      if (path.endsWith("/listing-type")) return { catalog_id: null }
      if (options.query.fields === PRODUCT_PAGE_FIELDS) {
        throw Object.assign(new Error("Inventory availability cannot be calculated in the given context."), {
          status: 400,
        })
      }
      if (options.query.fields === PRODUCT_PAGE_FIELDS_WITHOUT_STOCK) return withoutCounts
      return moreFromSellerResponse
    })

    const { product } = await renderPage()

    expect(productRequests(PRODUCT_PAGE_FIELDS_WITHOUT_STOCK).length).toBeGreaterThanOrEqual(1)
    const pint = product.variants?.find((v) => v.id === PINT)
    expect(pint?.manage_inventory).toBe(true)
    expect(pint).not.toHaveProperty("inventory_quantity")

    const { html, addToCartButton } = renderHeader(product, { size: "Pint" })

    expect(html).toContain("$5.00")
    expect(html).toContain("ADD TO CART")
    expect(html).not.toContain("OUT OF STOCK")
    expect(addToCartButton.disabled).toBe(false)
    await addToCartButton.onClick?.()
    expect(h.addToCart).toHaveBeenCalledWith({ variantId: PINT, quantity: 1, countryCode: "us" })
  })

  it("could sell nothing on the five fields the page used to fetch", () => {
    const asFetchedBefore = {
      id: fixture.id,
      title: fixture.title,
      handle: fixture.handle,
      thumbnail: fixture.thumbnail,
      status: fixture.status,
    } as PageProduct

    const { html, addToCartButton } = renderHeader(asFetchedBefore)

    expect(html).toContain("Not available in your region")
    expect(html).toContain("NOT AVAILABLE IN YOUR REGION")
    expect(html).not.toContain("$")
    expect(addToCartButton.disabled).toBe(true)
  })
})
