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
  addToCart,
  applyPromotions,
  deleteLineItem,
  deletePromotionCode,
  getOrSetCart,
  listCartOptions,
  placeOrder,
  refreshCardPaymentSession,
  removeShippingMethod,
  retrieveCart,
  setCartTier,
  setShippingMethod,
  updateCart,
  updateLineItem,
} from "@/lib/data/cart"
import { ALREADY_PLACED_GUEST_MESSAGE } from "@/lib/helpers/cart-completion"

const authed = { Authorization: "Bearer t" }

beforeEach(() => {
  // Reset, not clear: a test that makes a mock reject (the cookie write a page
  // render refuses) must not leave it rejecting for the tests after it.
  vi.resetAllMocks()
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

/**
 * A completed cart left in the cookie. Measured on Postgres by the checkout
 * scout: after the order, `GET /store/carts/:id` still answers 200 with the
 * lines, and adding a line answers 400 "Cart … is already completed." The
 * storefront went on showing that cart, and every add to cart failed, for
 * the cookie's seven days.
 */
describe("a completed cart in the cookie", () => {
  const completed = {
    id: "cart_1",
    region_id: "reg_us",
    completed_at: "2026-11-17T12:00:00.000Z",
    items: [{ id: "li_1", variant_id: "variant_1", quantity: 1 }],
  }

  it("is no cart: retrieveCart answers null and drops the cookie that holds it", async () => {
    h.medusaFetch.mockResolvedValue({ cart: completed })

    await expect(retrieveCart()).resolves.toBeNull()
    expect(h.removeCartId).toHaveBeenCalledTimes(1)
  })

  it("leaves the cookie alone when it holds another cart", async () => {
    h.medusaFetch.mockResolvedValue({ cart: { ...completed, id: "cart_old" } })

    await expect(retrieveCart("cart_old")).resolves.toBeNull()
    expect(h.removeCartId).not.toHaveBeenCalled()
  })

  it("still reads as no cart while a page renders, where Next.js refuses to write cookies", async () => {
    h.medusaFetch.mockResolvedValue({ cart: completed })
    h.removeCartId.mockRejectedValue(
      new Error("Cookies can only be modified in a Server Action or Route Handler.")
    )

    await expect(retrieveCart()).resolves.toBeNull()
  })

  it("is replaced by a new cart when the buyer adds to cart, and the new line goes on the new cart", async () => {
    h.getRegion.mockResolvedValue({ id: "reg_us" })
    h.medusaFetch.mockResolvedValue({ cart: completed })
    h.cartCreate.mockResolvedValue({ cart: { id: "cart_new", region_id: "reg_us", items: [] } })
    h.cartCreateLineItem.mockResolvedValue({ cart: { id: "cart_new" } })

    await addToCart({ variantId: "variant_1", quantity: 1, countryCode: "us" })

    expect(h.cartCreate).toHaveBeenCalledWith({ region_id: "reg_us" }, {}, authed)
    expect(h.setCartId).toHaveBeenCalledWith("cart_new")
    // A new line on the new cart, not a quantity bump on the completed one.
    expect(h.cartUpdateLineItem).not.toHaveBeenCalled()
    expect(h.cartCreateLineItem).toHaveBeenCalledWith(
      "cart_new",
      { variant_id: "variant_1", quantity: 1 },
      {},
      authed
    )
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

describe("refreshCardPaymentSession (the pay button's Update payment, SD-114/SD-115)", () => {
  // backend/integration-tests/http/cart-payment-refresh.spec.ts runs these
  // same two calls on Postgres, in both stale states, and completes the cart.
  const cart = { id: "cart_1", payment_collection: { id: "pay_col_1" } } as any

  it("has Medusa update the cart with nothing to change, then opens the session again, in that order, and then revalidates", async () => {
    const order: string[] = []
    h.cartUpdate.mockImplementation(async () => {
      order.push("update")
      return { cart }
    })
    h.paymentInitiate.mockImplementation(async () => {
      order.push("session")
      return { payment_collection: { id: "pay_col_1" } }
    })
    h.revalidateTag.mockImplementation(() => order.push("revalidate"))

    await expect(refreshCardPaymentSession(cart, { provider_id: "pp_stripe_stripe" })).resolves.toEqual({
      payment_collection: { id: "pay_col_1" },
    })

    expect(order).toEqual(["update", "session", "revalidate"])
    expect(h.cartUpdate).toHaveBeenCalledWith("cart_1", {}, {}, authed)
    expect(h.paymentInitiate).toHaveBeenCalledWith(cart, { provider_id: "pp_stripe_stripe" }, {}, authed)
    expect(h.revalidateTag).toHaveBeenCalledWith("tag")
  })

  it("passes the session data on (an approved subscription cart's off-session setup)", async () => {
    h.cartUpdate.mockResolvedValue({ cart })
    h.paymentInitiate.mockResolvedValue({})
    const data = { provider_id: "pp_stripe_stripe", data: { setup_future_usage: "off_session" } }
    await refreshCardPaymentSession(cart, data)
    expect(h.paymentInitiate).toHaveBeenCalledWith(cart, data, {}, authed)
  })

  it("throws and leaves the page as it was when the update fails: no session is opened, nothing is revalidated", async () => {
    h.cartUpdate.mockRejectedValue(new Error("Failed to acquire lock for key cart_1"))
    await expect(refreshCardPaymentSession(cart, { provider_id: "pp_stripe_stripe" })).rejects.toThrow()
    expect(h.paymentInitiate).not.toHaveBeenCalled()
    expect(h.revalidateTag).not.toHaveBeenCalled()
  })

  it("throws and leaves the page as it was when the session cannot be opened again", async () => {
    h.cartUpdate.mockResolvedValue({ cart })
    h.paymentInitiate.mockRejectedValue(new Error("Stripe said no"))
    await expect(refreshCardPaymentSession(cart, { provider_id: "pp_stripe_stripe" })).rejects.toThrow()
    expect(h.revalidateTag).not.toHaveBeenCalled()
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

  it("drops the cookie before it redirects: a redirect throws, so nothing after it runs", async () => {
    const order: string[] = []
    h.removeCartId.mockImplementation(async () => {
      order.push("forget")
    })
    h.redirect.mockImplementation(() => {
      order.push("redirect")
    })
    h.fetchQuery.mockResolvedValue({ data: { order_set: { orders: [{ id: "order_1" }] } } })

    await placeOrder("cart_1")

    expect(order).toEqual(["forget", "redirect"])
  })
})

/**
 * The main checkout's 409s (backend SD-147). Their bodies as
 * `backend/src/api/middlewares/cart-completion-guards.ts` and
 * `backend/src/lib/cart-completion.ts` write them, as fetchQuery hands them on.
 */
describe("placeOrder on the main checkout's 409s", () => {
  const ALREADY_PLACED_MESSAGE =
    "Your order for this cart has already been placed. You can find it under Orders in your account, or in your order confirmation email."
  const INCOMPLETE_MESSAGE =
    "Your order could not be completed, and no payment was taken. If your card shows a pending authorization, it will be released. Please try again, or contact support if it happens again."
  const CHECK_FAILED_MESSAGE =
    "Your order was not placed, because we could not check your cart just now. Please try again in a moment."

  const refusal = (error: Record<string, unknown>) => ({
    ok: false,
    status: 409,
    requestId: null,
    data: null,
    error: { type: error.code, requestId: null, ...error },
  })

  it("sends the buyer to the order a cart already became, and forgets the cart", async () => {
    h.fetchQuery.mockResolvedValue(
      refusal({ code: "cart_already_completed", message: ALREADY_PLACED_MESSAGE, orderId: "order_9" })
    )

    await placeOrder()

    expect(h.removeCartId).toHaveBeenCalledTimes(1)
    expect(h.redirect).toHaveBeenCalledWith("/order/order_9/confirmed")
    expect(h.revalidatePath).toHaveBeenCalledWith("/user/orders")
  })

  it("sends a signed-in buyer to the confirmation page too: the account's order page is keyed by order set, which that order has none of", async () => {
    h.getAuthHeaders.mockResolvedValue(authed)
    h.fetchQuery.mockResolvedValue(
      refusal({ code: "cart_already_completed", message: ALREADY_PLACED_MESSAGE, orderId: "order_9" })
    )

    await placeOrder()

    expect(h.redirect).toHaveBeenCalledWith("/order/order_9/confirmed")
  })

  it("tells a guest where the order is without pointing at an account they do not have, when no order is named", async () => {
    h.getAuthHeaders.mockResolvedValue(null)
    h.fetchQuery.mockResolvedValue(
      refusal({ code: "cart_already_completed", message: ALREADY_PLACED_MESSAGE })
    )

    const res = await placeOrder()

    expect(h.redirect).not.toHaveBeenCalled()
    expect(h.removeCartId).toHaveBeenCalledTimes(1)
    expect(res?.error?.message).toBe(ALREADY_PLACED_GUEST_MESSAGE)
    expect(res?.error?.message).not.toMatch(/account/i)
    expect(res?.error?.code).toBe("cart_already_completed")
  })

  it("keeps the backend's wording for a signed-in buyer when no order is named", async () => {
    h.fetchQuery.mockResolvedValue(
      refusal({ code: "cart_already_completed", message: ALREADY_PLACED_MESSAGE })
    )

    const res = await placeOrder()

    expect(res?.error?.message).toBe(ALREADY_PLACED_MESSAGE)
    expect(h.removeCartId).toHaveBeenCalledTimes(1)
  })

  it.each([
    ["cart_completion_incomplete", INCOMPLETE_MESSAGE],
    ["cart_completion_check_failed", CHECK_FAILED_MESSAGE],
  ])("on %s shows the message and keeps the cart, so the buyer can try again", async (code, message) => {
    const answer = refusal({ code, message })
    h.fetchQuery.mockResolvedValue(answer)

    const res = await placeOrder()

    expect(res).toEqual(answer)
    expect(h.removeCartId).not.toHaveBeenCalled()
    expect(h.redirect).not.toHaveBeenCalled()
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
