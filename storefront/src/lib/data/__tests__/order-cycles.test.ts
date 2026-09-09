import { beforeEach, describe, expect, it, vi } from "vitest"

const { medusaFetch, addToCart } = vi.hoisted(() => ({
  medusaFetch: vi.fn(),
  addToCart: vi.fn(),
}))

vi.mock("@/lib/config", () => ({ medusaFetch }))
vi.mock("@/lib/data/cart", () => ({ addToCart }))

import {
  addCycleProductToCart,
  checkCycleAvailability,
  getOrderCycle,
  listOrderCycles,
} from "@/lib/data/order-cycles"

/**
 * The storefront's order-cycle client.
 *
 * The property that matters most is the carrier: `order_cycle_id` goes on the
 * LINE ITEM, not on cart metadata. FBM checks out through `@mercurjs/b2c-core`,
 * whose split-and-complete workflow never copies `cart.metadata` onto the
 * orders it creates, so a cart-level tag would be written and then silently
 * dropped — leaving the sale uncounted, which is the exact failure this seam
 * exists to fix.
 */
beforeEach(() => {
  vi.clearAllMocks()
})

describe("reads", () => {
  it("lists cycles and unwraps the payload", async () => {
    medusaFetch.mockResolvedValue({ order_cycles: [{ id: "oc_1" }] })

    expect(await listOrderCycles()).toEqual([{ id: "oc_1" }])
    expect(medusaFetch.mock.calls[0][0]).toBe("/store/order-cycles")
    expect(medusaFetch.mock.calls[0][1].cache).toBe("no-store")
  })

  it("returns an empty list when the payload has no cycles key", async () => {
    medusaFetch.mockResolvedValue({})
    expect(await listOrderCycles()).toEqual([])
  })

  it("returns null for a cycle that cannot be fetched", async () => {
    // The detail route 404s anything not open or upcoming, so a stale deep
    // link is a normal outcome, not an exception to surface.
    medusaFetch.mockRejectedValue(new Error("404"))
    expect(await getOrderCycle("oc_gone")).toBeNull()
  })
})

describe("availability", () => {
  it("asks the cycle before anything enters the cart", async () => {
    medusaFetch.mockResolvedValue({ available: true })
    await checkCycleAvailability("oc_1", "v_1", 3)

    expect(medusaFetch.mock.calls[0][0]).toBe("/store/order-cycles/oc_1/availability")
    expect(medusaFetch.mock.calls[0][1].body).toEqual({
      variant_id: "v_1",
      quantity: 3,
    })
  })

  it("defaults to one", async () => {
    medusaFetch.mockResolvedValue({ available: true })
    await checkCycleAvailability("oc_1", "v_1")

    expect(medusaFetch.mock.calls[0][1].body).toMatchObject({ quantity: 1 })
  })
})

describe("addCycleProductToCart", () => {
  it("puts the cycle on the LINE ITEM, not on cart metadata", async () => {
    // Cart metadata is dropped by Mercur's completion workflow; line-item
    // metadata is carried through to the order item.
    medusaFetch.mockResolvedValue({ available: true })

    const result = await addCycleProductToCart({
      orderCycleId: "oc_1",
      variantId: "v_1",
      quantity: 2,
      countryCode: "us",
    })

    expect(result).toEqual({ ok: true })
    expect(addToCart).toHaveBeenCalledWith({
      variantId: "v_1",
      quantity: 2,
      countryCode: "us",
      metadata: { order_cycle_id: "oc_1" },
    })
  })

  it("checks availability before adding, and adds nothing when refused", async () => {
    // Refusing before the item is in the cart is what makes the refusal cheap
    // — there is nothing for the buyer to take back out.
    medusaFetch.mockResolvedValue({
      available: false,
      reason: "Only 2 units available",
      max_quantity: 2,
    })

    const result = await addCycleProductToCart({
      orderCycleId: "oc_1",
      variantId: "v_1",
      quantity: 5,
      countryCode: "us",
    })

    expect(result).toEqual({
      ok: false,
      reason: "Only 2 units available",
      maxQuantity: 2,
    })
    expect(addToCart).not.toHaveBeenCalled()
  })

  it("surfaces the cycle's own wording rather than inventing one", async () => {
    medusaFetch.mockResolvedValue({
      available: false,
      reason: "Order cycle is closed, not accepting orders",
    })

    const result = await addCycleProductToCart({
      orderCycleId: "oc_1",
      variantId: "v_1",
      quantity: 1,
      countryCode: "us",
    })

    expect(result).toMatchObject({
      ok: false,
      reason: "Order cycle is closed, not accepting orders",
    })
    expect(result).not.toHaveProperty("maxQuantity")
  })

  it("still says something useful when the cycle gives no reason", async () => {
    medusaFetch.mockResolvedValue({ available: false })

    const result = await addCycleProductToCart({
      orderCycleId: "oc_1",
      variantId: "v_1",
      quantity: 1,
      countryCode: "us",
    })

    expect(result).toMatchObject({ ok: false })
    expect((result as { reason: string }).reason).toMatch(/not available/i)
  })

  it("checks the same quantity it is about to add", async () => {
    medusaFetch.mockResolvedValue({ available: true })
    await addCycleProductToCart({
      orderCycleId: "oc_1",
      variantId: "v_1",
      quantity: 4,
      countryCode: "us",
    })

    expect(medusaFetch.mock.calls[0][1].body).toMatchObject({ quantity: 4 })
    expect(addToCart.mock.calls[0][0].quantity).toBe(4)
  })
})
