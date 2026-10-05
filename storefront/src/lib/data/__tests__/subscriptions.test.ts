import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  fetchQuery: vi.fn(),
  getAuthHeaders: vi.fn(),
  getCacheTag: vi.fn(),
  removeCartId: vi.fn(),
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
  retrieveCart: vi.fn(),
  addToCart: vi.fn(),
  updateCart: vi.fn(),
}))

vi.mock("@/lib/config", () => ({ fetchQuery: h.fetchQuery }))
vi.mock("../config", () => ({ fetchQuery: h.fetchQuery }))
vi.mock("../cookies", () => ({
  getAuthHeaders: h.getAuthHeaders,
  getCacheTag: h.getCacheTag,
  removeCartId: h.removeCartId,
}))
vi.mock("../cart", () => ({
  retrieveCart: h.retrieveCart,
  addToCart: h.addToCart,
  updateCart: h.updateCart,
}))
vi.mock("next/cache", () => ({ revalidateTag: h.revalidateTag, revalidatePath: h.revalidatePath }))
vi.mock("next/navigation", () => ({ redirect: h.redirect }))

import {
  approveAutoRenew,
  completeSubscriptionCheckout,
  disableAutoRenew,
  startSubscriptionCheckout,
} from "@/lib/data/subscriptions"
import {
  AUTO_RENEW_DISCLOSURE_VERSION,
  AUTO_RENEW_REAPPROVAL_DISCLOSURE_VERSION,
} from "@/lib/subscriptions/auto-renew"

beforeEach(() => {
  vi.clearAllMocks()
  h.getAuthHeaders.mockResolvedValue({ Authorization: "Bearer t" })
  h.getCacheTag.mockResolvedValue("carts-tag")
  h.fetchQuery.mockResolvedValue({ ok: true, data: { subscription: { id: "sub_1" } }, error: null })
})

describe("completeSubscriptionCheckout", () => {
  it("approved: sends the approval and the disclosure version", async () => {
    await completeSubscriptionCheckout("cart_1", {
      interval: "monthly",
      auto_renew_approved: true,
      auto_renew_disclosure_version: AUTO_RENEW_DISCLOSURE_VERSION,
    })
    expect(h.fetchQuery).toHaveBeenCalledWith("/store/subscriptions", {
      method: "POST",
      headers: { Authorization: "Bearer t" },
      body: {
        cart_id: "cart_1",
        interval: "monthly",
        period: 1,
        type: "membership",
        auto_renew_approved: true,
        auto_renew_disclosure_version: AUTO_RENEW_DISCLOSURE_VERSION,
      },
    })
    expect(h.removeCartId).toHaveBeenCalled()
    expect(h.redirect).toHaveBeenCalledWith("/user/subscriptions")
  })

  it("declined: an explicit false and no version", async () => {
    await completeSubscriptionCheckout("cart_1", {
      interval: "monthly",
      auto_renew_approved: false,
      auto_renew_disclosure_version: null,
    })
    const body = h.fetchQuery.mock.calls[0][1].body
    expect(body.auto_renew_approved).toBe(false)
    expect(body).not.toHaveProperty("auto_renew_disclosure_version")
  })

  it("a refusal is returned, the cart kept", async () => {
    h.fetchQuery.mockResolvedValue({ ok: false, data: null, error: { message: "nope" } })
    const res = await completeSubscriptionCheckout("cart_1", {
      interval: "monthly",
      auto_renew_approved: false,
      auto_renew_disclosure_version: null,
    })
    expect(res).toEqual({ ok: false, error: "nope" })
    expect(h.removeCartId).not.toHaveBeenCalled()
  })
})

describe("startSubscriptionCheckout", () => {
  it("refuses a cart that already holds items", async () => {
    h.retrieveCart.mockResolvedValue({ id: "cart_1", items: [{ id: "item_1" }] })
    const res = await startSubscriptionCheckout({
      variantId: "variant_1",
      countryCode: "us",
      checkout: { interval: "monthly", auto_renew_approved: false, auto_renew_disclosure_version: null },
    })
    expect(res).toMatchObject({ ok: false })
    expect(h.addToCart).not.toHaveBeenCalled()
  })

  it("adds the one item, records the answer on the cart, goes to checkout", async () => {
    h.retrieveCart.mockResolvedValue(null)
    const checkout = {
      interval: "monthly" as const,
      auto_renew_approved: true,
      auto_renew_disclosure_version: AUTO_RENEW_DISCLOSURE_VERSION,
    }
    await startSubscriptionCheckout({ variantId: "variant_1", countryCode: "us", checkout })
    expect(h.addToCart).toHaveBeenCalledWith({ variantId: "variant_1", quantity: 1, countryCode: "us" })
    // The answer is tied to the one variant it was given for.
    expect(h.updateCart).toHaveBeenCalledWith({
      metadata: { subscription_checkout: { ...checkout, variant_id: "variant_1" } },
    })
    expect(h.redirect).toHaveBeenCalledWith("/us/checkout?step=address")
  })
})

describe("auto-renew toggle", () => {
  it("disable and re-approve post the right actions; re-approval names the current re-approval version", async () => {
    await disableAutoRenew("sub_1")
    await approveAutoRenew("sub_1")
    expect(h.fetchQuery.mock.calls[0]).toEqual([
      "/store/subscriptions/sub_1",
      { method: "POST", headers: { Authorization: "Bearer t" }, body: { action: "disable_auto_renew" } },
    ])
    expect(h.fetchQuery.mock.calls[1][1].body).toEqual({
      action: "approve_auto_renew",
      auto_renew_approved: true,
      auto_renew_disclosure_version: AUTO_RENEW_REAPPROVAL_DISCLOSURE_VERSION,
    })
  })
})
