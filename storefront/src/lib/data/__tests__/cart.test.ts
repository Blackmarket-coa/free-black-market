import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  fetchQuery: vi.fn(),
  medusaFetch: vi.fn(),
  cartCreate: vi.fn(),
  cartUpdate: vi.fn(),
  cartUpdateLineItem: vi.fn(),
  cartCreateLineItem: vi.fn(),
  cartDeleteLineItem: vi.fn(),
  paymentInitiate: vi.fn(),
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
      payment: { initiatePaymentSession: h.paymentInitiate },
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

import {
  applyPromotions,
  deleteLineItem,
  deletePromotionCode,
  getOrSetCart,
  listCartOptions,
  placeOrder,
  removeShippingMethod,
  retrieveCart,
  setCartTier,
  setShippingMethod,
  updateCart,
  updateLineItem,
} from "@/lib/data/cart"

const authed = { Authorization: "Bearer t" }

beforeEach(() => {
  vi.clearAllMocks()
  h.getAuthHeaders.mockResolvedValue(authed)
  h.getCacheTag.mockResolvedValue("tag")
  h.getCacheOptions.mockResolvedValue({})
  h.getCartId.mockResolvedValue("cart_1")
})

describe("retrieveCart", () => {
  it("returns null when there is no cart id", async () => {
    h.getCartId.mockResolvedValue(undefined)
    await expect(retrieveCart()).resolves.toBeNull()
    expect(h.medusaFetch).not.toHaveBeenCalled()
  })

  it("returns the cart on success", async () => {
    h.medusaFetch.mockResolvedValue({ cart: { id: "cart_1" } })
    await expect(retrieveCart()).resolves.toEqual({ id: "cart_1" })
  })

  it("returns null when the fetch throws", async () => {
    h.medusaFetch.mockRejectedValue(new Error("boom"))
    await expect(retrieveCart("cart_x")).resolves.toBeNull()
  })
})

describe("getOrSetCart", () => {
  it("throws when the region cannot be resolved", async () => {
    h.getRegion.mockResolvedValue(null)
    await expect(getOrSetCart("zz")).rejects.toThrow("Region not found")
  })

  it("creates a cart when none exists", async () => {
    h.getRegion.mockResolvedValue({ id: "reg_us" })
    h.medusaFetch.mockResolvedValue({ cart: null }) // retrieveCart -> null
    h.cartCreate.mockResolvedValue({ cart: { id: "cart_new", region_id: "reg_us" } })

    const cart = await getOrSetCart("us")
    expect(cart).toEqual({ id: "cart_new", region_id: "reg_us" })
    expect(h.setCartId).toHaveBeenCalledWith("cart_new")
    expect(h.applyAttributionToCart).toHaveBeenCalledWith("cart_new")
  })

  it("updates the region when the existing cart's region differs", async () => {
    h.getRegion.mockResolvedValue({ id: "reg_eu" })
    h.medusaFetch.mockResolvedValue({ cart: { id: "cart_1", region_id: "reg_us" } })
    h.cartUpdate.mockResolvedValue({ cart: { id: "cart_1", region_id: "reg_eu" } })

    await getOrSetCart("de")
    expect(h.cartUpdate).toHaveBeenCalledWith(
      "cart_1",
      { region_id: "reg_eu" },
      {},
      authed
    )
  })

  it("does not block on attribution failures", async () => {
    h.getRegion.mockResolvedValue({ id: "reg_us" })
    h.medusaFetch.mockResolvedValue({ cart: { id: "cart_1", region_id: "reg_us" } })
    h.applyAttributionToCart.mockRejectedValue(new Error("attr down"))

    await expect(getOrSetCart("us")).resolves.toEqual({
      id: "cart_1",
      region_id: "reg_us",
    })
  })
})

describe("updateCart", () => {
  it("throws when there is no cart id", async () => {
    h.getCartId.mockResolvedValue(undefined)
    await expect(updateCart({ email: "a@x.com" })).rejects.toThrow(
      "No existing cart found"
    )
  })

  it("updates and returns the cart", async () => {
    h.cartUpdate.mockResolvedValue({ cart: { id: "cart_1" } })
    await expect(updateCart({ email: "a@x.com" })).resolves.toEqual({
      id: "cart_1",
    })
    expect(h.revalidateTag).toHaveBeenCalledWith("tag")
  })
})

describe("setCartTier", () => {
  it("rejects an invalid tier", async () => {
    // @ts-expect-error testing runtime guard with a bad value
    await expect(setCartTier("premium")).rejects.toThrow("Invalid sliding-scale tier")
  })

  it("posts the tier and returns the repricing result", async () => {
    h.medusaFetch.mockResolvedValue({
      cart_id: "cart_1",
      tier: "solidarity",
      line_items_repriced: 3,
    })
    await expect(setCartTier("solidarity")).resolves.toEqual({
      tier: "solidarity",
      line_items_repriced: 3,
    })
    expect(h.medusaFetch).toHaveBeenCalledWith(
      "/store/carts/cart_1/tier",
      expect.objectContaining({ method: "POST", body: { tier: "solidarity" } })
    )
  })
})

describe("line items", () => {
  it("updateLineItem throws without a line id", async () => {
    await expect(updateLineItem({ lineId: "", quantity: 1 })).rejects.toThrow(
      "Missing lineItem ID"
    )
  })

  it("updateLineItem posts the new quantity", async () => {
    h.fetchQuery.mockResolvedValue({ ok: true })
    await expect(
      updateLineItem({ lineId: "li_1", quantity: 2 })
    ).resolves.toEqual({ ok: true })
    expect(h.fetchQuery).toHaveBeenCalledWith(
      "/store/carts/cart_1/line-items/li_1",
      expect.objectContaining({ method: "POST", body: { quantity: 2 } })
    )
  })

  it("deleteLineItem throws without a line id", async () => {
    await expect(deleteLineItem("")).rejects.toThrow("Missing lineItem ID")
  })

  it("deleteLineItem deletes and revalidates", async () => {
    h.cartDeleteLineItem.mockResolvedValue({})
    await deleteLineItem("li_1")
    expect(h.cartDeleteLineItem).toHaveBeenCalledWith("cart_1", "li_1", {}, authed)
    expect(h.revalidateTag).toHaveBeenCalledWith("tag")
  })
})

describe("shipping & promotions", () => {
  it("setShippingMethod posts the option id", async () => {
    h.fetchQuery.mockResolvedValue({ ok: true })
    await expect(
      setShippingMethod({ cartId: "cart_1", shippingMethodId: "so_1" })
    ).resolves.toEqual({ ok: true })
    expect(h.fetchQuery).toHaveBeenCalledWith(
      "/store/carts/cart_1/shipping-methods",
      expect.objectContaining({ body: { option_id: "so_1" } })
    )
  })

  it("applyPromotions returns whether the code was applied", async () => {
    h.cartUpdate.mockResolvedValue({
      cart: { promotions: [{ code: "SAVE10" }] },
    })
    await expect(applyPromotions(["SAVE10"])).resolves.toBe(true)
  })

  it("applyPromotions throws without a cart id", async () => {
    h.getCartId.mockResolvedValue(undefined)
    await expect(applyPromotions(["X"])).rejects.toThrow("No existing cart found")
  })

  it("removeShippingMethod deletes via medusaFetch", async () => {
    h.medusaFetch.mockResolvedValue({})
    await removeShippingMethod("sm_1")
    expect(h.medusaFetch).toHaveBeenCalledWith(
      "/store/carts/cart_1/shipping-methods",
      expect.objectContaining({
        method: "DELETE",
        body: { shipping_method_ids: ["sm_1"] },
      })
    )
  })

  it("deletePromotionCode deletes via medusaFetch", async () => {
    h.medusaFetch.mockResolvedValue({})
    await deletePromotionCode("SAVE10")
    expect(h.medusaFetch).toHaveBeenCalledWith(
      "/store/carts/cart_1/promotions",
      expect.objectContaining({
        method: "DELETE",
        body: { promo_codes: ["SAVE10"] },
      })
    )
  })
})

describe("placeOrder", () => {
  it("throws when there is no cart id", async () => {
    h.getCartId.mockResolvedValue(undefined)
    await expect(placeOrder()).rejects.toThrow("No existing cart found")
  })

  it("returns the response when no order_set is present", async () => {
    h.fetchQuery.mockResolvedValue({ data: {} })
    await expect(placeOrder("cart_1")).resolves.toEqual({ data: {} })
    expect(h.redirect).not.toHaveBeenCalled()
  })

  it("redirects to the confirmation page when an order is created", async () => {
    h.fetchQuery.mockResolvedValue({
      data: { order_set: { orders: [{ id: "order_1" }] } },
    })
    await placeOrder("cart_1")
    expect(h.removeCartId).toHaveBeenCalled()
    expect(h.redirect).toHaveBeenCalledWith("/order/order_1/confirmed")
  })
})

describe("listCartOptions", () => {
  it("fetches shipping options scoped to the cart", async () => {
    h.medusaFetch.mockResolvedValue({ shipping_options: [{ id: "so_1" }] })
    await expect(listCartOptions()).resolves.toEqual({
      shipping_options: [{ id: "so_1" }],
    })
    expect(h.medusaFetch).toHaveBeenCalledWith(
      "/store/shipping-options",
      expect.objectContaining({ query: { cart_id: "cart_1" } })
    )
  })
})
