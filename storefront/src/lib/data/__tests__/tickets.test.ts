import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  fetchQuery: vi.fn(),
  medusaFetch: vi.fn(),
  cartCreate: vi.fn(),
  cartUpdate: vi.fn(),
  cartUpdateLineItem: vi.fn(),
  cartCreateLineItem: vi.fn(),
  cartDeleteLineItem: vi.fn(),
  getAuthHeaders: vi.fn(),
  getCacheOptions: vi.fn(),
  getCacheTag: vi.fn(),
  getCartId: vi.fn(),
  setCartId: vi.fn(),
  removeCartId: vi.fn(),
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
  getRegion: vi.fn(),
  applyAttributionToCart: vi.fn(),
}))

vi.mock("@/lib/config", () => ({
  fetchQuery: h.fetchQuery,
  medusaFetch: h.medusaFetch,
  sdk: {
    store: {
      cart: {
        create: h.cartCreate,
        update: h.cartUpdate,
        updateLineItem: h.cartUpdateLineItem,
        createLineItem: h.cartCreateLineItem,
        deleteLineItem: h.cartDeleteLineItem,
      },
    },
  },
}))

vi.mock("@/lib/data/cookies", () => ({
  getAuthHeaders: h.getAuthHeaders,
  getCacheOptions: h.getCacheOptions,
  getCacheTag: h.getCacheTag,
  getCartId: h.getCartId,
  setCartId: h.setCartId,
  removeCartId: h.removeCartId,
}))

vi.mock("next/cache", () => ({
  revalidateTag: h.revalidateTag,
  revalidatePath: h.revalidatePath,
}))
vi.mock("next/navigation", () => ({ redirect: h.redirect }))
vi.mock("@/lib/data/regions", () => ({ getRegion: h.getRegion }))
vi.mock("@/lib/data/attribution", () => ({
  applyAttributionToCart: h.applyAttributionToCart,
}))

import { addToCart, placeTicketOrder } from "@/lib/data/cart"
import { getTicketAvailability, getTicketSeatMap } from "@/lib/data/tickets"

const authed = { Authorization: "Bearer t" }

const ticketMetadata = {
  venue_row_id: "row_a",
  seat_number: "4",
  show_date: "2026-08-01",
}

beforeEach(() => {
  vi.clearAllMocks()
  h.getAuthHeaders.mockResolvedValue(authed)
  h.getCacheTag.mockResolvedValue("tag")
  h.getCacheOptions.mockResolvedValue({})
  h.getCartId.mockResolvedValue("cart_1")
})

describe("getTicketAvailability", () => {
  it("returns venue name and per-date availability", async () => {
    h.medusaFetch.mockResolvedValue({
      ticket_product: { venue: { name: "The Vault" } },
      availability: [
        {
          date: "2026-08-01",
          row_types: [
            {
              row_type: "premium",
              total_seats: 2,
              available_seats: 1,
              sold_out: false,
            },
          ],
          sold_out: false,
        },
      ],
    })

    await expect(getTicketAvailability("prod_1")).resolves.toEqual({
      venue_name: "The Vault",
      dates: [
        expect.objectContaining({ date: "2026-08-01", sold_out: false }),
      ],
    })
    expect(h.medusaFetch).toHaveBeenCalledWith(
      "/store/ticket-products/prod_1/availability",
      expect.objectContaining({ method: "GET", cache: "no-cache" })
    )
  })

  it("returns null without fetching when the product id is missing", async () => {
    await expect(getTicketAvailability("")).resolves.toBeNull()
    expect(h.medusaFetch).not.toHaveBeenCalled()
  })

  it("returns null when the response has no availability array", async () => {
    h.medusaFetch.mockResolvedValue({ message: "not a ticket product" })
    await expect(getTicketAvailability("prod_1")).resolves.toBeNull()
  })

  it("returns null when the fetch throws (e.g. no linked ticket product)", async () => {
    h.medusaFetch.mockRejectedValue(new Error("404"))
    await expect(getTicketAvailability("prod_1")).resolves.toBeNull()
  })
})

describe("getTicketSeatMap", () => {
  it("passes the date and returns the seat map with venue_row_id", async () => {
    h.medusaFetch.mockResolvedValue({
      venue: { id: "ven_1" },
      date: "2026-08-01",
      seat_map: [
        {
          row_number: "A",
          row_type: "premium",
          venue_row_id: "row_a",
          seats: [{ number: "1", is_purchased: false, variant_id: "variant_1" }],
        },
      ],
    })

    await expect(getTicketSeatMap("prod_1", "2026-08-01")).resolves.toEqual({
      date: "2026-08-01",
      seat_map: [
        expect.objectContaining({ row_number: "A", venue_row_id: "row_a" }),
      ],
    })
    expect(h.medusaFetch).toHaveBeenCalledWith(
      "/store/ticket-products/prod_1/seats",
      expect.objectContaining({
        method: "GET",
        query: { date: "2026-08-01" },
        cache: "no-cache",
      })
    )
  })

  it("returns null without fetching when arguments are missing", async () => {
    await expect(getTicketSeatMap("prod_1", "")).resolves.toBeNull()
    expect(h.medusaFetch).not.toHaveBeenCalled()
  })

  it("returns null when the fetch throws", async () => {
    h.medusaFetch.mockRejectedValue(new Error("boom"))
    await expect(getTicketSeatMap("prod_1", "2026-08-01")).resolves.toBeNull()
  })
})

describe("addToCart with ticket metadata", () => {
  const cartWithVariantInIt = {
    cart: {
      id: "cart_1",
      region_id: "reg_us",
      items: [{ id: "li_1", variant_id: "variant_1", quantity: 1 }],
    },
  }

  beforeEach(() => {
    h.getRegion.mockResolvedValue({ id: "reg_us" })
    h.medusaFetch.mockResolvedValue(cartWithVariantInIt)
    h.cartCreateLineItem.mockResolvedValue({})
    h.cartUpdateLineItem.mockResolvedValue({})
  })

  it("always creates a new line item carrying the metadata, even when the variant is already in the cart", async () => {
    await addToCart({
      variantId: "variant_1",
      quantity: 1,
      countryCode: "us",
      metadata: ticketMetadata,
    })

    expect(h.cartCreateLineItem).toHaveBeenCalledWith(
      "cart_1",
      { variant_id: "variant_1", quantity: 1, metadata: ticketMetadata },
      {},
      authed
    )
    expect(h.cartUpdateLineItem).not.toHaveBeenCalled()
  })

  it("still merges quantity into the existing line item when no metadata is passed", async () => {
    await addToCart({ variantId: "variant_1", quantity: 1, countryCode: "us" })

    expect(h.cartUpdateLineItem).toHaveBeenCalledWith(
      "cart_1",
      "li_1",
      { quantity: 2 },
      {},
      authed
    )
    expect(h.cartCreateLineItem).not.toHaveBeenCalled()
  })

  it("omits the metadata key entirely when none is passed and the variant is new", async () => {
    h.medusaFetch.mockResolvedValue({
      cart: { id: "cart_1", region_id: "reg_us", items: [] },
    })

    await addToCart({ variantId: "variant_2", quantity: 1, countryCode: "us" })

    expect(h.cartCreateLineItem).toHaveBeenCalledWith(
      "cart_1",
      { variant_id: "variant_2", quantity: 1 },
      {},
      authed
    )
  })
})

describe("placeTicketOrder", () => {
  it("throws when there is no cart id", async () => {
    h.getCartId.mockResolvedValue(undefined)
    await expect(placeTicketOrder()).rejects.toThrow("No existing cart found")
  })

  it("completes via the complete-tickets endpoint", async () => {
    h.fetchQuery.mockResolvedValue({ ok: false, error: { message: "seat taken" }, data: null })

    await expect(placeTicketOrder("cart_1")).resolves.toEqual({
      ok: false,
      error: { message: "seat taken" },
      data: null,
    })
    expect(h.fetchQuery).toHaveBeenCalledWith(
      "/store/carts/cart_1/complete-tickets",
      expect.objectContaining({ method: "POST" })
    )
    expect(h.redirect).not.toHaveBeenCalled()
  })

  it("redirects to the confirmation page when the ticket order is created", async () => {
    h.fetchQuery.mockResolvedValue({
      ok: true,
      data: { type: "order", order: { id: "order_1" } },
    })

    await placeTicketOrder("cart_1")

    expect(h.removeCartId).toHaveBeenCalled()
    expect(h.redirect).toHaveBeenCalledWith("/order/order_1/confirmed")
  })
})
