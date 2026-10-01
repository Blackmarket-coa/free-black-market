import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  medusaFetch: vi.fn(),
  getAuthHeaders: vi.fn(),
  cookieStore: {
    values: new Map<string, string>(),
    get: vi.fn(),
    set: vi.fn(),
  },
}))

vi.mock("@/lib/config", () => ({ medusaFetch: h.medusaFetch }))
vi.mock("@/lib/data/cookies", () => ({ getAuthHeaders: h.getAuthHeaders }))
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => h.cookieStore),
}))

import { applyAttributionToCart } from "../attribution"

const seedCookies = (entries: Record<string, string>) => {
  h.cookieStore.values = new Map(Object.entries(entries))
}

describe("applyAttributionToCart", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.cookieStore.get.mockImplementation((name: string) => {
      const value = h.cookieStore.values.get(name)
      return value === undefined ? undefined : { name, value }
    })
    h.getAuthHeaders.mockResolvedValue(null)
    h.medusaFetch.mockResolvedValue({})
  })

  it("does not POST when the visitor has not consented", async () => {
    seedCookies({ _fbm_aff: "abc123.1700000000", _fbm_visitor: "v-1" })

    await applyAttributionToCart("cart_1")

    expect(h.medusaFetch).not.toHaveBeenCalled()
    expect(h.cookieStore.set).not.toHaveBeenCalled()
  })

  it("does not POST when the visitor chose essential cookies only", async () => {
    seedCookies({
      fbm_consent: "essential",
      _fbm_aff: "abc123.1700000000",
      _fbm_visitor: "v-1",
    })

    await applyAttributionToCart("cart_1")

    expect(h.medusaFetch).not.toHaveBeenCalled()
  })

  it("POSTs the ref code and visitor token once consent is accepted", async () => {
    seedCookies({
      fbm_consent: "accepted",
      _fbm_aff: "abc123.1700000000",
      _fbm_visitor: "v-1",
    })

    await applyAttributionToCart("cart_1")

    expect(h.medusaFetch).toHaveBeenCalledTimes(1)
    const [path, init] = h.medusaFetch.mock.calls[0]
    expect(path).toBe("/store/carts/cart_1/attribution")
    expect(init.method).toBe("POST")
    expect(JSON.parse(init.body)).toEqual({
      ref_code: "abc123",
      visitor_token: "v-1",
    })
    expect(h.cookieStore.set).toHaveBeenCalledWith(
      "_fbm_aff_applied_cart_1",
      "abc123",
      expect.objectContaining({ httpOnly: true, sameSite: "lax" })
    )
  })

  it("skips when consent is given but no affiliate cookie exists", async () => {
    seedCookies({ fbm_consent: "accepted" })

    await applyAttributionToCart("cart_1")

    expect(h.medusaFetch).not.toHaveBeenCalled()
  })

  it("skips a cart already stamped with the same code", async () => {
    seedCookies({
      fbm_consent: "accepted",
      _fbm_aff: "abc123.1700000000",
      _fbm_aff_applied_cart_1: "abc123",
    })

    await applyAttributionToCart("cart_1")

    expect(h.medusaFetch).not.toHaveBeenCalled()
  })
})
