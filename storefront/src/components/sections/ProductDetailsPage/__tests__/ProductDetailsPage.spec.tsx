import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import React, { isValidElement, type ReactElement, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import type { HttpTypes } from "@medusajs/types"

/**
 * The product page, from its fetch to its Add to Cart button, on a product
 * shaped like the backend's real answer.
 *
 * `fixtures/product-page-response.json` is not hand-written: it is the body
 * `GET /store/products` returned for the storefront's product-page query in
 * `backend/integration-tests/http/store-product-page-query.spec.ts` (real
 * Postgres; that spec rewrites the file when run with
 * PRODUCT_PAGE_FIXTURE_OUT). Two variants of one product: the pint is counted
 * by Medusa and has 7 in stock, the crate is not counted, so it carries no
 * `inventory_quantity` at all.
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
}))
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
import { PRODUCT_PAGE_FIELDS } from "@/lib/data/product-query"
import { ProductDetails, ProductGallery as GallerySlot } from "@/components/organisms"
import { ProductGallery } from "@/components/organisms/ProductGallery/ProductGallery"
import { ProductDetailsHeader } from "@/components/cells/ProductDetailsHeader/ProductDetailsHeader"
import type { ProductPageProduct as PageProduct } from "@/lib/data/products"
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

/** The page as the route renders it, and the props it hands its two halves. */
async function renderPage() {
  const tree = await ProductDetailsPage({ handle: "heirloom-tomatoes", locale: "us" })
  const elements = walk(tree)
  const gallery = elements.find((el) => el.type === GallerySlot)
  const details = elements.find((el) => el.type === ProductDetails)
  if (!gallery || !details) throw new Error("the page rendered no gallery or no details")
  return {
    images: (gallery.props as { images: HttpTypes.StoreProduct["images"] }).images,
    product: (details.props as { product: PageProduct }).product,
  }
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
    h.medusaFetch.mockImplementation(async (path: string) => {
      if (path === "/store/products") return response
      if (path.endsWith("/listing-type")) return { catalog_id: null }
      throw new Error(`unexpected request ${path}`)
    })
  })

  it("fetches the product with the page's fields in the visitor's region", async () => {
    await renderPage()

    const productRequests = h.medusaFetch.mock.calls.filter(([path]) => path === "/store/products")
    expect(productRequests).toHaveLength(1)
    expect(productRequests[0][1].query).toEqual({
      handle: ["heirloom-tomatoes"],
      limit: 1,
      offset: 0,
      region_id: "reg_us",
      country_code: "us",
      fields: PRODUCT_PAGE_FIELDS,
    })
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
